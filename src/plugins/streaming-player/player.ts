import type {
  StreamingPlayerHandle,
  StreamingPlayerOptions,
  StreamingPlayerState,
} from "./types"
import type { StreamingPacketPayload } from "../../types"
import { ReorderBuffer } from "./reorder-buffer"
import { JitterBuffer } from "./jitter-buffer"
import type { PersistStore } from "./persist-store"
import { IndexedDbPersistStore, MemoryPersistStore } from "./persist-store"

/**
 * 创建流式播放器。
 *
 * 数据流：
 *   push(packet)
 *     ├─→ persistStore（双写，始终写入，用于重播）
 *     └─→（playing / buffering / paused 恢复后）ReorderBuffer → JitterBuffer → decode → AudioBufferSourceNode
 *
 * idle / 暂停时：push 只写 persistStore，不进入播放管线。
 * start() / resume()：从当前 live edge 重新缓冲；start() 会用最近一个小窗口的历史包作为启动垫片。
 * 重播：只能在暂停时调用，从 persistStore.recent() 取历史 packet 播放，播完保持暂停。
 */
export async function createStreamingPlayer(
  options: StreamingPlayerOptions
): Promise<StreamingPlayerHandle> {
  const {
    decoders,
    targetLatencyMs = 300,
    maxBufferMs = 3000,
    volume = 1.0,
    persistMode = "memory",
    persistBufferMs = 10_000,
    audioContext: externalCtx,
    onUnderrun,
    onPacketDrop,
    onStateChange,
  } = options

  // 默认走内置 persist-store；custom 模式下必须由调用方通过 use() 显式注册。
  let persistStore: PersistStore | null =
    persistMode === "custom"
      ? null
      : persistMode === "indexeddb"
        ? new IndexedDbPersistStore(persistBufferMs)
        : new MemoryPersistStore(persistBufferMs)
  const ownsPersistStore = persistMode !== "custom"

  // 播放器状态
  let _state: StreamingPlayerState = "idle"
  // _bufferedMs 表示整条播放管线的总余量：
  //   reorder 队列 + jitter 队列 + 等待解码/调度的包 + 已调度未播完的音频。
  let _bufferedMs = 0
  let _droppedPackets = 0
  let _paused = false
  let _destroyed = false
  let _hasSeenPacket = false

  // 调度状态
  let _scheduleTime = 0
  let _playbackStarted = false
  let _playbackStartedAt = 0 // audioCtx.currentTime when playback first started
  let _drainInterval: ReturnType<typeof setInterval> | null = null

  // 可在创建后替换的状态回调
  let _onStateChange: ((state: StreamingPlayerState) => void) | null =
    onStateChange ?? null

  function setState(s: StreamingPlayerState): void {
    _state = s
    _onStateChange?.(s)
  }

  function requirePersistStore(): PersistStore {
    if (persistStore) return persistStore
    throw new Error(
      'Streaming player persistMode "custom" requires player.use(store) before push(), start(), or replay().'
    )
  }

  // AudioContext + GainNode
  const audioCtx = externalCtx ?? new AudioContext()
  const gainNode = audioCtx.createGain()
  gainNode.gain.value = volume
  gainNode.connect(audioCtx.destination)

  if (audioCtx.state === "suspended") {
    await audioCtx.resume()
  }

  // 解码器映射
  const decoderMap = new Map(decoders.map((d) => [d.format, d]))

  // 缓冲管线
  const reorderBuf = new ReorderBuffer()
  const jitterBuf = new JitterBuffer(targetLatencyMs)

  // 串行解码队列：保证解码顺序与出队顺序一致，避免并发解码导致乱序调度
  let _decodeChain: Promise<void> = Promise.resolve()
  // 已从 jitter 出队、但仍在等待解码/调度的时长。
  let _pendingDecodeMs = 0

  // 已调度但尚未播完的 AudioBufferSourceNode，用于 destroy 时强制停止（外部 ctx 场景）
  const _activeSources = new Set<AudioBufferSourceNode>()

  function getScheduledAheadMs(): number {
    if (_scheduleTime <= 0) return 0
    return Math.max(0, (_scheduleTime - audioCtx.currentTime) * 1000)
  }

  function syncBufferedMs(): void {
    _bufferedMs = Math.max(
      0,
      reorderBuf.getBufferedMs() +
        jitterBuf.getBufferedMs() +
        _pendingDecodeMs +
        getScheduledAheadMs()
    )
  }

  function getStartupPadMs(): number {
    return targetLatencyMs > 0 ? targetLatencyMs : 20
  }

  function enqueuePlaybackPacket(packet: StreamingPacketPayload): void {
    // 明确不连续点后，丢弃旧的乱序等待状态，避免无意义地再等 200ms 缺口超时。
    if (packet.discontinuity) {
      reorderBuf.reset()
    }
    reorderBuf.push(packet)
    enforceMaxBufferedPackets()
    syncBufferedMs()
  }

  function emitPacketDrop(count: number): void {
    if (count <= 0) return
    _droppedPackets += count
    onPacketDrop?.({ count, reason: "max-buffer-exceeded" })
  }

  /**
   * live 模式只保留有限播放积压。
   * 优先丢弃 jitter 中最旧的已排序数据；若仍超限，再丢弃 reorder 中等待重排的旧数据。
   */
  function enforceMaxBufferedPackets(): void {
    let excess =
      reorderBuf.getBufferedMs() + jitterBuf.getBufferedMs() - maxBufferMs
    if (excess <= 0) return

    const droppedFromJitter = jitterBuf.dropOld(excess)
    emitPacketDrop(droppedFromJitter)

    excess =
      reorderBuf.getBufferedMs() + jitterBuf.getBufferedMs() - maxBufferMs
    if (excess <= 0) return

    const droppedFromReorder = reorderBuf.dropOld(excess)
    emitPacketDrop(droppedFromReorder)
  }

  // JitterBuffer 释放的 packet：先进入串行解码队列，再调度到 AudioContext。
  jitterBuf.onRelease = (pkt) => {
    _pendingDecodeMs += pkt.durationMs
    syncBufferedMs()
    // 将每个包的解码任务追加到串行链，保证先出队的包先完成调度
    _decodeChain = _decodeChain.then(async () => {
      if (_destroyed || _paused) return
      try {
        const buf = await decodePacket(pkt)
        // 解码完成后再次检查状态，避免解码期间 pause/destroy 导致错误排队
        if (!buf || _destroyed || _paused) return
        scheduleAudioBuffer(buf)
        if (!_playbackStarted) {
          _playbackStarted = true
          _playbackStartedAt = audioCtx.currentTime
          setState("playing")
        }
      } finally {
        _pendingDecodeMs = Math.max(0, _pendingDecodeMs - pkt.durationMs)
        syncBufferedMs()
      }
    })
  }

  // ReorderBuffer 排序后交给 JitterBuffer
  reorderBuf.onRelease = (ordered) => {
    jitterBuf.push(ordered)
    enforceMaxBufferedPackets()
    syncBufferedMs()
  }

  // ──────────────────────────────────────────────────────────────────
  // 内部工具
  // ──────────────────────────────────────────────────────────────────

  function stopDrainLoop(): void {
    if (_drainInterval !== null) {
      clearInterval(_drainInterval)
      _drainInterval = null
    }
  }

  function stopActiveSources(): void {
    for (const src of _activeSources) {
      try {
        src.stop()
      } catch {
        // source may already be stopped or ended
      }
    }
    _activeSources.clear()
  }

  /** 清空播放管线（不清 persistStore） */
  function resetPipeline(): void {
    reorderBuf.reset()
    jitterBuf.reset()
    _pendingDecodeMs = 0
    _bufferedMs = 0
    _scheduleTime = 0
    _playbackStarted = false
  }

  async function decodePacket(
    packet: StreamingPacketPayload
  ): Promise<AudioBuffer | null> {
    const decoder = decoderMap.get(packet.format)
    if (!decoder) return null
    try {
      const decoded = await decoder.decode({
        format: packet.format,
        sampleRate: packet.sampleRate,
        channels: packet.channels,
        chunk: packet.chunk,
      })
      const { sampleRate, channels, planar } = decoded
      const frameCount = planar[0]?.length ?? 0
      if (frameCount === 0) return null
      const audioBuf = audioCtx.createBuffer(channels, frameCount, sampleRate)
      for (let ch = 0; ch < channels; ch++) {
        const channelData = planar[ch]
        if (!channelData) continue
        audioBuf.copyToChannel(channelData as Float32Array<ArrayBuffer>, ch)
      }
      return audioBuf
    } catch {
      return null
    }
  }

  function scheduleAudioBuffer(buf: AudioBuffer): void {
    const src = audioCtx.createBufferSource()
    src.buffer = buf
    src.connect(gainNode)

    const now = audioCtx.currentTime
    if (_scheduleTime < now) _scheduleTime = now
    src.start(_scheduleTime)
    _scheduleTime += buf.duration

    // 跟踪已调度节点，供 destroy 在外部 ctx 场景下强制停止
    _activeSources.add(src)
    src.onended = () => {
      _activeSources.delete(src)
    }
  }

  function startDrainLoop(): void {
    if (_drainInterval !== null) return
    _drainInterval = setInterval(() => {
      if (_destroyed || _paused) return

      // 触发 reorderBuf 超时放行
      reorderBuf.drain()

      // 只在已调度余量不足时释放 jitter，避免以固定 60ms/tick 的速度过快抽干缓冲。
      const desiredAheadMs = targetLatencyMs > 0 ? targetLatencyMs : 20
      const decodeAndScheduledMs = _pendingDecodeMs + getScheduledAheadMs()
      const releaseBudgetMs = Math.max(0, desiredAheadMs - decodeAndScheduledMs)
      if (releaseBudgetMs > 0) {
        jitterBuf.drain(releaseBudgetMs)
      }
      syncBufferedMs()

      // 欠载检测：需要至少 200ms 的播放宽限期，避免解码异步延迟导致误判
      const gracePeriod = 0.2 // 200ms 宽限期
      if (
        _playbackStarted &&
        _state === "playing" &&
        audioCtx.currentTime > _playbackStartedAt + gracePeriod &&
        _bufferedMs <= 0 &&
        audioCtx.currentTime > _scheduleTime + 0.05
      ) {
        _bufferedMs = 0
        onUnderrun?.({ bufferedMs: 0 })
        setState("buffering")
        _playbackStarted = false
        _scheduleTime = 0
      }
    }, 20)
  }

  // ──────────────────────────────────────────────────────────────────
  // 公开 API
  // ──────────────────────────────────────────────────────────────────

  function push(packet: StreamingPacketPayload): void {
    if (_destroyed) return

    const store = requirePersistStore()
    _hasSeenPacket = true

    // 双写：始终写入 persistStore
    store.push(packet)

    // 仅在已开始实时播放后才进入播放管线。
    // idle 阶段只保留历史，避免 start() 后永远从旧 backlog 慢速追赶。
    if (_paused || _state === "idle") return

    enqueuePlaybackPacket(packet)
  }

  async function start(): Promise<void> {
    if (_destroyed || _state !== "idle") return
    const store = requirePersistStore()
    if (audioCtx.state === "suspended") {
      await audioCtx.resume()
    }

    // 进入 live-edge 启动：丢弃 idle 期间的旧播放积压，只取最近一个小窗口作为起播垫片。
    resetPipeline()
    setState("buffering")
    const startupPackets = store.recent(getStartupPadMs())
    for (const packet of startupPackets) {
      enqueuePlaybackPacket(packet)
    }
    startDrainLoop()
  }

  function pause(): void {
    if (_destroyed || _paused) return
    _paused = true
    stopDrainLoop()
    // 停止所有已调度但尚未播完的 source，避免暂停后 live 音频继续播出
    stopActiveSources()
    // 仅在内部创建的 AudioContext 上调用 suspend，避免影响外部共享的 context
    if (!externalCtx) {
      void audioCtx.suspend()
    }
    setState("paused")
  }

  function resume(): void {
    if (_destroyed || !_paused) return
    // 若当前正在 replay，恢复实时播放前应先停止历史回放节点，避免 live/replay 叠播
    stopActiveSources()
    _paused = false

    // 清空播放管线中积压的旧数据，避免恢复后出现长延时
    resetPipeline()

    void audioCtx.resume()
    setState("buffering")
    startDrainLoop()
  }

  /**
   * 重播最近 seconds 秒的历史音频。
   * 只能在暂停状态下调用，播完后保持暂停。
   */
  function replay(seconds: number): void {
    if (_destroyed || !_paused) return

    const packets = requirePersistStore().recent(seconds * 1000)
    if (packets.length === 0) return

    void (async () => {
      // 先恢复 audioCtx（暂停期间 audioCtx 是 suspended）
      await audioCtx.resume()
      // resume() 之后再取 currentTime，避免 suspended 状态下时间未推进导致调度时间已过期
      let replayScheduleTime = audioCtx.currentTime + 0.05

      for (const pkt of packets) {
        if (_destroyed || !_paused) break
        const buf = await decodePacket(pkt)
        if (!buf) continue
        const src = audioCtx.createBufferSource()
        src.buffer = buf
        src.connect(gainNode)
        src.start(replayScheduleTime)
        replayScheduleTime += buf.duration
        // 跟踪重播节点，供 destroy 强制停止
        _activeSources.add(src)
        src.onended = () => {
          _activeSources.delete(src)
        }
      }

      // 等待重播完成后，再次暂停 audioCtx（保持 paused 状态）
      // 注意：replayScheduleTime 是 audioCtx 时间轴上的结束点，用它减去当前时间得到剩余等待量
      const waitMs = Math.max(
        0,
        (replayScheduleTime - audioCtx.currentTime) * 1000
      )
      setTimeout(() => {
        if (_destroyed) return
        if (_paused) {
          void audioCtx.suspend()
        }
      }, waitMs + 100)
    })()
  }

  function setVolume(vol: number): void {
    gainNode.gain.value = Math.max(0, Math.min(1, vol))
  }

  function destroy(): void {
    if (_destroyed) return
    _destroyed = true
    stopDrainLoop()
    if (ownsPersistStore) {
      persistStore?.clear()
    }
    reorderBuf.reset()
    jitterBuf.reset()
    // 外部 ctx 场景下无法 close()，强制停止所有已调度但未播完的 source
    stopActiveSources()
    if (!externalCtx) {
      void audioCtx.close()
    }
    setState("stopped")
  }

  return {
    get state() {
      return _state
    },
    get bufferedMs() {
      return _bufferedMs
    },
    get droppedPackets() {
      return _droppedPackets
    },
    get storedMs() {
      return persistStore?.storedMs ?? 0
    },
    get onStateChange() {
      return _onStateChange
    },
    set onStateChange(fn: ((state: StreamingPlayerState) => void) | null) {
      _onStateChange = fn
    },
    use(store: PersistStore) {
      if (persistMode !== "custom") {
        throw new Error(
          'player.use(store) is only available when persistMode is "custom".'
        )
      }
      if (persistStore !== null) {
        throw new Error("Custom PersistStore has already been registered.")
      }
      if (_state !== "idle" || _hasSeenPacket) {
        throw new Error(
          "Custom PersistStore must be registered before the first push() or start()."
        )
      }
      persistStore = store
    },
    push,
    start,
    pause,
    resume,
    replay,
    setVolume,
    destroy,
  }
}
