import type { RecorderPlugin } from "@/plugins/types"
import type {
  ChunkedEncoderDefinition,
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

  // 构建局部查表，不依赖任何全局注册表
  const encoderMap: Record<string, ChunkedEncoderDefinition> = {}
  for (const def of encoders) {
    encoderMap[def.format] = def
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

    setup(context) {
      context.eventBus.register("plugin:encoded-chunk")
      emitChunk = (payload) => {
        context.eventBus.emit("plugin:encoded-chunk", payload)
      }
    },

    onStart() {
      bridge?.dispose()
      bridge = new ChunkedEncoderBridge({
        format,
        encoderOptions,
        definition,
        allowMainThreadFallback,
      })
      sequenceIndex = 0
      currentSessionId++
      isActive = true
    },

    onFrame(frame) {
      if (!isActive || bridge === undefined) {
        return
      }

      const capturedSeq = sequenceIndex++
      const capturedSessionId = currentSessionId

      // fire-and-forget：编码在 Worker / 主线程完成后回调 emit
      bridge
        ?.feedFrame(frame.channels, frame.sampleRate, frame.planar)
        ?.then((chunk) => {
          // 若 session 已切换（stop 后又 start），丢弃过期 chunk
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
              isFinal: false,
            })
          }
        })
        ?.catch(() => {
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
      if (bridge === null) {
        return
      }

      const capturedSeq = sequenceIndex++
      const capturedSessionId = currentSessionId

      bridge
        ?.flush()
        ?.then((finalChunk) => {
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
              isFinal: true,
            })
          }
        })
        ?.catch(() => {
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
