/**
 * StreamingPlayer 核心编排器
 *
 * 流水线：push(packet) -> reorder-buffer -> jitter-buffer -> decode -> AudioBufferSourceNode scheduling
 *
 * 设计原则：
 * - 无 SharedArrayBuffer，兼容所有浏览器
 * - 业务层负责订阅 recorder/websocket 并调用 handle.push(packet)
 * - decoders 由业务层从主库 codecs 注入
 */

import type {
  StreamingPlayerHandle,
  StreamingPlayerOptions,
  StreamingPlayerState,
} from "./types"
import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"
import { ReorderBuffer } from "./reorder-buffer"
import { JitterBuffer } from "./jitter-buffer"

export async function createStreamingPlayer(
  options: StreamingPlayerOptions
): Promise<StreamingPlayerHandle> {
  const {
    decoders,
    targetLatencyMs = 300,
    maxBufferMs = 3000,
    backlogPolicy = "drop-old",
    volume = 1.0,
    audioContext: externalCtx,
    onUnderrun,
    onPacketDrop,
    onStateChange,
  } = options

  let _state: StreamingPlayerState = "idle"
  let _droppedPackets = 0
  let _paused = false
  let _destroyed = false
  let _volume = volume

  // 累计缓冲量（毫秒），基于入队的 packet.durationMs
  let _bufferedMs = 0
  // 下一个 AudioBufferSourceNode 的计划播放时间
  let _scheduleTime = 0
  // 是否已收到足够的缓冲开始播放
  let _playbackStarted = false

  function setState(s: StreamingPlayerState) {
    _state = s
    onStateChange?.(s)
  }

  // --- AudioContext ---
  const audioCtx = externalCtx ?? new AudioContext()
  const gainNode = audioCtx.createGain()
  gainNode.gain.value = _volume
  gainNode.connect(audioCtx.destination)

  if (audioCtx.state === "suspended") {
    await audioCtx.resume()
  }

  // --- Decoder map ---
  const decoderMap = new Map(decoders.map((d) => [d.format, d]))

  // --- Buffers ---
  const reorderBuf = new ReorderBuffer()
  const jitterBuf = new JitterBuffer(targetLatencyMs)

  /**
   * 将已解码的 planar PCM 调度为 AudioBufferSourceNode
   */
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
    if (_scheduleTime < now) {
      if (_playbackStarted) {
        onUnderrun?.({ bufferedMs: 0 })
        _playbackStarted = false
        _bufferedMs = 0
        jitterBuf.reset()
        reorderBuf.reset()
      }
      _scheduleTime = now
    }

    source.start(_scheduleTime)
    _scheduleTime += frames / sampleRate
  }

  /**
   * 解码 packet 并调度播放
   */
  async function processPacket(packet: StreamingPacketPayload): Promise<void> {
    if (_paused || _destroyed) return

    const decoder = decoderMap.get(packet.format)
    if (!decoder) return

    try {
      const decoded = await decoder.decode({
        format: packet.format,
        sampleRate: packet.sampleRate,
        channels: packet.channels,
        chunk: packet.chunk,
      })

      _bufferedMs = Math.max(0, _bufferedMs - (packet.durationMs ?? 0))
      scheduleAudioBuffer(decoded.planar, decoded.sampleRate, decoded.channels)

      if (!_playbackStarted) {
        _playbackStarted = true
        setState("playing")
      }
    } catch {
      // decode error — skip packet
    }
  }

  // Pipeline wiring
  jitterBuf.onRelease = (packet) => {
    void processPacket(packet)
  }
  reorderBuf.onRelease = (packet) => {
    jitterBuf.push(packet)
  }

  // Drain loop at 20ms intervals
  const drainInterval = setInterval(() => {
    if (_paused || _destroyed) return
    reorderBuf.drain()
    jitterBuf.drain()

    if (
      _playbackStarted &&
      _scheduleTime < audioCtx.currentTime &&
      _bufferedMs === 0
    ) {
      onUnderrun?.({ bufferedMs: 0 })
    }
  }, 20)

  setState("buffering")

  // --- Public push function ---
  function push(packet: StreamingPacketPayload): void {
    if (_destroyed) return

    if (packet.discontinuity) {
      reorderBuf.reset()
      jitterBuf.reset()
      _scheduleTime = 0
      _playbackStarted = false
      _bufferedMs = 0
      setState("buffering")
    }

    if (_bufferedMs > maxBufferMs) {
      if (backlogPolicy === "drop-old") {
        const dropped = jitterBuf.dropOld(_bufferedMs - maxBufferMs)
        _bufferedMs = Math.min(_bufferedMs, maxBufferMs)
        if (dropped > 0) {
          _droppedPackets += dropped
          onPacketDrop?.({ count: dropped, reason: "backlog-drop-old" })
        }
      } else {
        _droppedPackets++
        onPacketDrop?.({ count: 1, reason: "backlog-wait-drop" })
        return
      }
    }

    _bufferedMs += packet.durationMs ?? 0
    reorderBuf.push(packet)
  }

  // --- Public handle ---
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

    push,

    async start() {
      if (_destroyed) return
      if (audioCtx.state === "suspended") {
        await audioCtx.resume()
      }
      setState("buffering")
    },

    pause() {
      if (_destroyed || _paused) return
      _paused = true
      setState("paused")
      void audioCtx.suspend()
    },

    resume() {
      if (_destroyed || !_paused) return
      _paused = false
      // Reset schedule time so the next scheduled buffer anchors to current
      // AudioContext time rather than the stale pre-pause position.
      _scheduleTime = 0
      _playbackStarted = false
      setState("buffering")
      void audioCtx.resume()
    },

    setVolume(v: number) {
      _volume = Math.max(0, Math.min(1, v))
      gainNode.gain.value = _volume
    },

    destroy() {
      if (_destroyed) return
      _destroyed = true
      clearInterval(drainInterval)
      gainNode.disconnect()
      void audioCtx.close()
      setState("stopped")
    },
  }
}
