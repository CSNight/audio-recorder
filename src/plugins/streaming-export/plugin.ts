import type { RecorderPlugin } from "@/plugins/types"
import type {
  StreamEncoderDefinition,
  StreamingExportFormat,
  StreamingExportPluginOptions,
  StreamingPacketPayload,
} from "@/plugins/streaming-export/types"
import { ChunkedEncoderBridge } from "@/workers/chunked-encoder-bridge"
import type { AudioFrame } from "@/types"

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
export function createStreamingExportPlugin(
  options: StreamingExportPluginOptions
): RecorderPlugin {
  const { format, encoderOptions, allowMainThreadFallback, encoders } = options
  assertSupportedFormat(format)

  // 构建局部查表，不依赖任何全局注册表
  const encoderMap: Record<StreamingExportFormat, StreamEncoderDefinition> = {
    pcm: undefined as unknown as StreamEncoderDefinition,
    wav: undefined as unknown as StreamEncoderDefinition,
  }
  for (const def of encoders) {
    if (def.format === "pcm" || def.format === "wav") {
      encoderMap[def.format] = def
    }
  }

  const definition = encoderMap[format]
  if (!definition) {
    throw new Error(
      `ChunkedEncoder for format "${format}" not found. ` +
        `Please pass the corresponding StreamEncoderDefinition via options.encoders. ` +
        `Available formats: ${Object.keys(encoderMap).join(", ") || "(none)"}`
    )
  }

  let bridge: ChunkedEncoderBridge | undefined
  let packetSequenceIndex = 0
  let sessionId = ""
  let latestSampleRate = 0
  let latestChannels = 0
  let pendingDurationMs = 0
  let isActive = false
  let emitPacket: ((payload: StreamingPacketPayload) => void) | undefined

  return {
    name: `streaming-export:${format}`,

    async setup(context) {
      context.eventBus.register("plugin:stream")
      emitPacket = (payload) => {
        context.eventBus.emit("plugin:stream", payload)
      }

      // 预热 WASM 模块（若 definition 支持），await 确保 create() 调用时模块已就绪
      await definition.preload?.()

      // setup 时创建 Bridge（含 Worker），常驻于整个插件生命周期
      bridge = new ChunkedEncoderBridge({
        format,
        definition,
        encoderOptions,
        allowMainThreadFallback,
      })
    },

    onStart() {
      // 不再 new ChunkedEncoderBridge，改为 reset 已有 Bridge
      bridge!.reset(encoderOptions)
      packetSequenceIndex = 0
      sessionId = createStreamingSessionId()
      latestSampleRate = 0
      latestChannels = 0
      pendingDurationMs = 0
      isActive = true
    },

    onFrame(frame) {
      if (!isActive || !bridge) return

      const capturedSessionId = sessionId
      latestSampleRate = frame.sampleRate
      latestChannels = frame.channels

      // fire-and-forget：编码在 Worker / 主线程完成后回调 emit
      void bridge
        .feedFrame(frame.channels, frame.sampleRate, frame.planar)
        .then((chunk) => {
          emitPacketChunk(chunk, capturedSessionId, false, frame)
        })
        .catch(() => {
          // Worker 错误已在 bridge 内部通过 onerror 处理；bridge disposed 时也会 reject，此处静默
        })
    },

    onPause() {
      isActive = false
    },

    onResume() {
      isActive = true
    },

    onStop() {
      isActive = false

      const capturedSessionId = sessionId

      void bridge
        ?.flush()
        .then((finalChunk) => {
          emitPacketChunk(finalChunk, capturedSessionId, true)
        })
        .catch(() => {
          // 静默：bridge disposed 或 Worker 错误，isFinal chunk 丢失
        })
    },

    dispose() {
      isActive = false
      sessionId = ""
      bridge?.dispose()
      bridge = undefined
      emitPacket = undefined
      latestSampleRate = 0
      latestChannels = 0
      pendingDurationMs = 0
    },
  }
  function createStreamingSessionId(): string {
    return `stream-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  function assertSupportedFormat(
    format: string
  ): asserts format is StreamingExportFormat {
    if (format === "pcm" || format === "wav") {
      return
    }

    throw new Error(
      `Streaming export only supports "pcm" and "wav". Received "${format}".`
    )
  }

  function emitPacketChunk(
    chunk: Uint8Array | null,
    capturedSessionId: string,
    isFinal: boolean,
    frame?: AudioFrame
  ): void {
    if (chunk === null || !emitPacket || capturedSessionId !== sessionId) {
      if (!isFinal && frame && capturedSessionId === sessionId) {
        pendingDurationMs += frame.durationMs
      }
      return
    }

    if (!isFinal && frame) {
      pendingDurationMs += frame.durationMs
    }

    emitPacket({
      sessionId: capturedSessionId,
      sequenceIndex: packetSequenceIndex++,
      timestampMs: isFinal ? performance.now() : (frame?.timestamp ?? 0),
      durationMs: pendingDurationMs,
      sampleRate: isFinal ? latestSampleRate : (frame?.sampleRate ?? 0),
      channels: isFinal ? latestChannels : (frame?.channels ?? 0),
      format,
      chunk,
      isFinal,
    })
    pendingDurationMs = 0
  }
}
