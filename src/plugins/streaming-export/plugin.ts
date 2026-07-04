import type { RecorderPlugin } from "../types"
import type { StreamingPacketPayload } from "../../types"
import type { StreamingExportPluginOptions } from "./types"
import { ChunkedEncoderBridge } from "../../workers/chunked-encoder-bridge"
import type { AudioFrame } from "../../types"

/**
 * createStreamingExportPlugin：实时分片编码插件。
 *
 * 每帧 PCM 喂给指定格式的 StreamEncoder（经 ChunkedEncoderBridge），
 * 有产出时通过 "plugin:stream" 发出标准流式包。
 * Bridge 在 Worker 可用时将编码移入 Worker 线程，否则主线程同步降级。
 *
 * 用法：
 * ```ts
 * import { pcmStreamEncoder } from "@csnight/audio-recorder/codecs/base"
 * const plugin = createStreamingExportPlugin({
 *   format: "pcm",
 *   encoders: [pcmStreamEncoder],
 * })
 * recorder.use(plugin)
 * recorder.on("plugin:stream", ({ payload }) => {
 *   // payload: StreamingPacketPayload
 * })
 * ```
 */

/**
 * 帧时间戳积累器：
 * 编码器可能将多帧合并成一个 chunk，需要在无产出的帧上累积时长和起始时间戳，
 * 待 chunk 产出时一并写入 packet。
 */
interface PendingTime {
  /** 积累帧段的起始时间戳（ms），null 表示尚未开始积累 */
  startMs: number | null
  /** 已积累的总时长（ms） */
  durationMs: number
  /** 下一个 packet 的预期时间戳：上一 packet 的 startMs + durationMs */
  nextMs: number | null
  /** resume 后首个 packet 需标记不连续 */
  discontinuity: boolean
}

function makePendingTime(): PendingTime {
  return { startMs: null, durationMs: 0, nextMs: null, discontinuity: false }
}

function generateStreamId(): string {
  return `stream-${crypto.randomUUID()}`
}

function generateSessionId(): string {
  return `session-${crypto.randomUUID()}`
}

export function createStreamingExportPlugin(
  options: StreamingExportPluginOptions
): RecorderPlugin {
  const {
    format,
    encoderOptions,
    allowMainThreadFallback,
    encoders,
    createSessionId,
    metadata,
  } = options

  const streamId =
    options.streamId ?? options.createStreamId?.() ?? generateStreamId()

  const definition = encoders.find((e) => e.format === format)
  if (!definition) {
    const available = encoders.map((e) => e.format)
    throw new Error(
      `ChunkedEncoder for format "${format}" not found. ` +
        `Please pass the corresponding StreamEncoderDefinition via options.encoders. ` +
        `Available formats: ${available.join(", ") || "(none)"}`
    )
  }

  let bridge: ChunkedEncoderBridge | undefined
  let emitPacket: ((payload: StreamingPacketPayload) => void) | undefined

  // --- 每次录音会话的可变状态 ---
  let isActive = false
  let sessionId = ""
  let seq = 0
  let lastSampleRate = 0
  let lastChannels = 0
  let pending = makePendingTime()

  function resetSession(): void {
    isActive = false
    sessionId = ""
    seq = 0
    lastSampleRate = 0
    lastChannels = 0
    pending = makePendingTime()
  }

  return {
    name: `streaming-export:${format}`,

    async setup(context) {
      context.eventBus.register("plugin:stream")
      emitPacket = (payload) => context.eventBus.emit("plugin:stream", payload)

      // 预热 WASM 模块（若编码器支持），保证 create() 时模块已就绪
      await definition.preload?.()

      // Bridge 常驻整个插件生命周期，跨录音会话复用
      bridge = new ChunkedEncoderBridge({
        format,
        definition,
        encoderOptions,
        allowMainThreadFallback,
      })
    },

    onStart() {
      bridge!.reset(encoderOptions)
      resetSession()
      sessionId = createSessionId?.() ?? generateSessionId()
      isActive = true
    },

    onFrame(frame) {
      if (!isActive || !bridge) return

      lastSampleRate = frame.sampleRate
      lastChannels = frame.channels

      // 提前捕获 sessionId，防止异步回调时会话已切换
      const capturedSessionId = sessionId

      void bridge
        .feedFrame(frame.channels, frame.sampleRate, frame.planar)
        .then((chunk) => {
          if (capturedSessionId !== sessionId) return
          if (chunk !== null) {
            emitChunkPacket(chunk, capturedSessionId, frame)
          } else {
            accumulateFrame(frame)
          }
        })
        .catch(() => {
          // Worker 错误已在 bridge 内部处理；bridge disposed 时也会 reject，此处静默
        })
    },

    onPause() {
      isActive = false
    },

    onResume() {
      isActive = true
      pending.discontinuity = true
    },

    onStop() {
      isActive = false

      const capturedSessionId = sessionId

      void bridge
        ?.flush()
        .then((chunk) => {
          if (capturedSessionId === sessionId) {
            emitFinalPacket(chunk, capturedSessionId)
          }
        })
        .catch(() => {
          // 静默：isFinal packet 丢失，bridge 已 disposed 或 Worker 出错
        })
    },

    dispose() {
      resetSession()
      bridge?.dispose()
      bridge = undefined
      emitPacket = undefined
    },
  }

  // ---------------------------------------------------------------------------
  // 内部工具函数
  // ---------------------------------------------------------------------------

  /** 将当前帧的时间信息累积到 pending（编码器本次无产出时调用） */
  function accumulateFrame(frame: AudioFrame): void {
    if (pending.startMs === null) {
      pending.startMs = pending.nextMs ?? frame.timestamp
    }
    pending.durationMs += frame.durationMs
  }

  /** 构建并发出普通（非 final）packet，同时将当前帧时间合并进 pending 后一并输出 */
  function emitChunkPacket(
    chunk: Uint8Array,
    capturedSessionId: string,
    frame: AudioFrame
  ): void {
    // 将本帧时间并入积累器，然后将积累结果写入 packet
    accumulateFrame(frame)

    const timestampMs = pending.startMs ?? frame.timestamp
    const durationMs = pending.durationMs

    const packet: StreamingPacketPayload = {
      streamId,
      sessionId: capturedSessionId,
      seq: seq++,
      timestampMs,
      durationMs,
      sampleRate: frame.sampleRate,
      channels: frame.channels,
      format,
      chunk,
      isFinal: false,
    }
    if (pending.discontinuity) packet.discontinuity = true
    if (metadata !== undefined) packet.metadata = metadata

    emitPacket!(packet)

    // 更新下一 packet 的预期起始时间戳，并清空积累器
    pending.nextMs = timestampMs + durationMs
    pending.startMs = null
    pending.durationMs = 0
    pending.discontinuity = false
  }

  /** 构建并发出 flush 产生的 final packet；chunk 为 null（编码器无剩余）时不 emit */
  function emitFinalPacket(
    chunk: Uint8Array | null,
    capturedSessionId: string
  ): void {
    if (chunk === null) return

    const timestampMs = pending.startMs ?? pending.nextMs ?? 0

    const packet: StreamingPacketPayload = {
      streamId,
      sessionId: capturedSessionId,
      seq: seq++,
      timestampMs,
      durationMs: pending.durationMs,
      sampleRate: lastSampleRate,
      channels: lastChannels,
      format,
      chunk,
      isFinal: true,
    }
    if (pending.discontinuity) packet.discontinuity = true
    if (metadata !== undefined) packet.metadata = metadata

    emitPacket!(packet)
  }
}
