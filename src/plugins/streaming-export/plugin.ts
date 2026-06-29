import type { RecorderPlugin } from "@/plugins/types"
import type {
  ChunkedEncoderDefinition,
  StreamingExportFormat,
  StreamingChunkPayload,
  StreamingExportPluginOptions,
} from "@/plugins/streaming-export/types"
import { ChunkedEncoderBridge } from "@/workers/chunked-encoder-bridge"

/**
 * createStreamingExportPlugin：实时分片编码插件。
 *
 * 每帧 PCM 喂给指定格式的 ChunkedEncoder（经 ChunkedEncoderBridge），
 * 有产出时通过 "plugin:encoded-chunk" 事件发出。
 * Bridge 在 Worker 可用时将编码移入 Worker 线程，否则主线程同步降级。
 *
 * 用法：
 * ```ts
 * import { pcmChunkedEncoderDefinition } from "audio-recorder/codecs/pcm"
 * const plugin = createStreamingExportPlugin({
 *   format: "pcm",
 *   encoders: [pcmChunkedEncoderDefinition],
 * })
 * recorder.use(plugin)
 * recorder.on("plugin:encoded-chunk", ({ payload }) => {
 *   // payload: StreamingChunkPayload
 * })
 * ```
 */
export function createStreamingExportPlugin(
  options: StreamingExportPluginOptions
): RecorderPlugin {
  const { format, encoderOptions, allowMainThreadFallback, encoders } = options
  assertSupportedFormat(format)

  // 构建局部查表，不依赖任何全局注册表
  const encoderMap: Record<StreamingExportFormat, ChunkedEncoderDefinition> = {
    pcm: undefined as unknown as ChunkedEncoderDefinition,
    wav: undefined as unknown as ChunkedEncoderDefinition,
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
        `Please pass the corresponding ChunkedEncoderDefinition via options.encoders. ` +
        `Available formats: ${Object.keys(encoderMap).join(", ") || "(none)"}`
    )
  }

  let bridge: ChunkedEncoderBridge | undefined
  let sequenceIndex = 0
  let isActive = false
  // sessionId 用于区分 stop 后异步回调是否属于当前 session，防止跨 session 的 chunk 发出
  let currentSessionId = 0
  let emitChunk: ((payload: StreamingChunkPayload) => void) | undefined

  return {
    name: `streaming-export:${format}`,

    async setup(context) {
      context.eventBus.register("plugin:encoded-chunk")
      emitChunk = (payload) => {
        context.eventBus.emit("plugin:encoded-chunk", payload)
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
      sequenceIndex = 0
      currentSessionId++
      isActive = true
    },

    onFrame(frame) {
      if (!isActive || !bridge) return

      const capturedSeq = sequenceIndex++
      const capturedSessionId = currentSessionId

      // fire-and-forget：编码在 Worker / 主线程完成后回调 emit
      void bridge
        .feedFrame(frame.channels, frame.sampleRate, frame.planar)
        .then((chunk) => {
          if (
            chunk !== null &&
            emitChunk &&
            capturedSessionId === currentSessionId
          ) {
            emitChunk({
              chunk,
              format,
              timestampMs: frame.timestamp,
              sequenceIndex: capturedSeq,
              sampleRate: frame.sampleRate,
              channels: frame.channels,
              isFinal: false,
            })
          }
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

      const capturedSeq = sequenceIndex++
      const capturedSessionId = currentSessionId

      void bridge
        ?.flush()
        .then((finalChunk) => {
          if (
            finalChunk !== null &&
            emitChunk &&
            capturedSessionId === currentSessionId
          ) {
            emitChunk({
              chunk: finalChunk,
              format,
              timestampMs: performance.now(),
              sequenceIndex: capturedSeq,
              sampleRate: 0,
              channels: 0,
              isFinal: true,
            })
          }
        })
        .catch(() => {
          // 静默：bridge disposed 或 Worker 错误，isFinal chunk 丢失
        })
    },

    dispose() {
      isActive = false
      currentSessionId++
      bridge?.dispose()
      bridge = undefined
      emitChunk = undefined
    },
  }
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
