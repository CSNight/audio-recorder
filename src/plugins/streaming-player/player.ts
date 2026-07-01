import type {
  StreamingPlayerHandle,
  StreamingPlayerOptions,
  StreamingPlayerState,
} from "./types"
import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"
import { ReorderBuffer } from "./reorder-buffer"
import { JitterBuffer } from "./jitter-buffer"
import { MemoryRingStore } from "./memory-ring-store"

/**
 * 创建流式播放器。
 *
 * 流水线：push(packet) → ReorderBuffer → JitterBuffer → decode → AudioBufferSourceNode
 *
 * - 无 SharedArrayBuffer，兼容所有浏览器
 * - decoders 由业务层从主库 codecs 注入
 * - 业务层负责订阅 recorder / WebSocket 并调用 handle.push(packet)
 */
export async function createStreamingPlayer(
  options: StreamingPlayerOptions
): Promise<StreamingPlayerHandle> {
  const {
    decoders,
    targetLatencyMs = 300,
    maxBufferMs = 3000,
    backlogPolicy = "drop-old",
    volume = 1.0,
    autoPlay = true,
    audioContext: externalCtx,
    onUnderrun,
    onPacketDrop,
    onStateChange,
  } = options

  // 播放器状态
  let _state: StreamingPlayerState = "idle"
  let _bufferedMs = 0
  let _droppedPackets = 0
  let _paused = false
  let _destroyed = false

  // 调度状态
  let _scheduleTime = 0
  let _playbackStarted = false
  let _drainInterval: ReturnType<typeof setInterval> | null = null

  // 可在创建后替换的状态回调
  let _onStateChange: ((state: StreamingPlayerState) => void) | null =
    onStateChange ?? null

  function setState(s: StreamingPlayerState): void {
    _state = s
    _onStateChange?.(s)
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

  // 环形回放存储（容量 = maxBufferMs / 20ms × 2，最小 256）
  const ringStore = new MemoryRingStore(
    Math.max(256, Math.ceil(maxBufferMs / 20) * 2)
  )

  // 将 planar PCM 调度到 AudioBufferSourceNode
  function scheduleAudioBuffer(
    planar: Float32Array[],
    sampleRate: number,
    channels: number
  ): void {
    const frames = planar[0]?.length ?? 0
    if (frames === 0) return

    const audioBuf = audioCtx.createBuffer(channels, frames, sampleRate)
    for (let c = 0; c < channels; c++) {
      const ch = planar[c < planar.length ? c : 0]
      if (ch) audioBuf.copyToChannel(ch as Float32Array<ArrayBuffer>, c)
    }

    const source = audioCtx.createBufferSource()
    source.buffer = audioBuf
    source.connect(gainNode)

    const now = audioCtx.currentTime
    // 留 50ms lookahead 裕量，避免 decode 耗时导致 scheduleTime 追不上
    if (_scheduleTime < now - 0.05) {
      if (_playbackStarted) {
        onUnderrun?.({ bufferedMs: _bufferedMs })
        _playbackStarted = false
        setState("buffering")
      }
      // 从当前时间 + lookahead 开始重新排队，给 decode 留足时间
      _scheduleTime = now + 0.05
    }

    source.start(_scheduleTime)
    _scheduleTime += frames / sampleRate
  }

  // 解码单个 packet 并调度播放
  async function processPacket(packet: StreamingPacketPayload): Promise<void> {
    if (_paused || _destroyed) return

    // packet 离队，减缓冲量
    _bufferedMs = Math.max(0, _bufferedMs - (packet.durationMs ?? 0))

    const decoder = decoderMap.get(packet.format)
    if (!decoder) return

    try {
      const decoded = await decoder.decode({
        format: packet.format,
        sampleRate: packet.sampleRate,
        channels: packet.channels,
        chunk: packet.chunk,
      })

      if (_paused || _destroyed) return

      scheduleAudioBuffer(decoded.planar, decoded.sampleRate, decoded.channels)

      if (!_playbackStarted) {
        _playbackStarted = true
        setState("playing")
      }
    } catch {
      // 解码失败，跳过该 packet
    }
  }

  // 管线串联
  reorderBuf.onRelease = (packet) => jitterBuf.push(packet)
  jitterBuf.onRelease = (packet) => void processPacket(packet)

  function startDrainLoop(): void {
    if (_drainInterval !== null) return
    _drainInterval = setInterval(() => {
      if (_paused || _destroyed) return
      reorderBuf.drain()
      jitterBuf.drain()
    }, 20)
  }

  function stopDrainLoop(): void {
    if (_drainInterval === null) return
    clearInterval(_drainInterval)
    _drainInterval = null
  }

  function resetPipeline(): void {
    _scheduleTime = 0
    _playbackStarted = false
    _bufferedMs = 0
    reorderBuf.reset()
    jitterBuf.reset()
  }

  if (autoPlay) {
    setState("buffering")
    startDrainLoop()
  }

  // 构建 handle，用 Object.defineProperty 使 onStateChange 可动态赋值
  const handle = {
    get state() {
      return _state
    },
    get bufferedMs() {
      return _bufferedMs
    },
    get droppedPackets() {
      return _droppedPackets
    },

    push(packet: StreamingPacketPayload): void {
      if (_destroyed) return

      if (packet.discontinuity) {
        resetPipeline()
        setState("buffering")
      }

      if (_bufferedMs >= maxBufferMs) {
        if (backlogPolicy === "drop-old") {
          // 先尝试从 jitterBuf 删旧包
          const excess = _bufferedMs - maxBufferMs + (packet.durationMs ?? 0)
          const dropped = jitterBuf.dropOld(excess)
          if (dropped > 0) {
            _bufferedMs -= dropped * (packet.durationMs ?? 0) // 近似，按包平均时长
            _bufferedMs = Math.max(0, _bufferedMs)
            _droppedPackets += dropped
            onPacketDrop?.({ count: dropped, reason: "backlog-drop-old" })
          } else {
            // jitterBuf 为空（包还在 reorderBuf），直接丢弃当前入站包
            _droppedPackets++
            onPacketDrop?.({ count: 1, reason: "backlog-drop-old" })
            return
          }
        } else {
          _droppedPackets++
          onPacketDrop?.({ count: 1, reason: "backlog-wait-drop" })
          return
        }
      }

      _bufferedMs += packet.durationMs ?? 0
      ringStore.push(packet)
      reorderBuf.push(packet)
    },

    async start(): Promise<void> {
      if (_destroyed) return
      if (audioCtx.state === "suspended") await audioCtx.resume()
      setState("buffering")
      startDrainLoop()
    },

    pause(): void {
      if (_destroyed || _paused) return
      _paused = true
      setState("paused")
      stopDrainLoop()
      void audioCtx.suspend()
    },

    resume(): void {
      if (_destroyed || !_paused) return
      _paused = false
      _scheduleTime = 0
      _playbackStarted = false
      setState("buffering")
      void audioCtx.resume()
      startDrainLoop()
    },

    replay(seconds: number): void {
      if (_destroyed) return
      const packets = ringStore.recent(seconds * 1000)
      if (packets.length === 0) return
      resetPipeline()
      setState("buffering")
      for (const p of packets) {
        _bufferedMs += p.durationMs ?? 0
        reorderBuf.push(p)
      }
    },

    setVolume(v: number): void {
      gainNode.gain.value = Math.max(0, Math.min(1, v))
    },

    async destroy(): Promise<void> {
      if (_destroyed) return
      _destroyed = true
      stopDrainLoop()
      gainNode.disconnect()
      setState("stopped")
      await audioCtx.close()
    },
  }

  Object.defineProperty(handle, "onStateChange", {
    get(): ((state: StreamingPlayerState) => void) | null {
      return _onStateChange
    },
    set(fn: ((state: StreamingPlayerState) => void) | null) {
      _onStateChange = fn
    },
    enumerable: true,
    configurable: true,
  })

  return handle as unknown as StreamingPlayerHandle
}
