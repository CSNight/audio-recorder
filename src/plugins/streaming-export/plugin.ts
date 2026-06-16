import type { RecorderPlugin } from "@/plugins/types"
import type {
  StreamingChunkPayload,
  StreamingExportPluginOptions,
} from "@/plugins/streaming-export/types"
import type { ChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"
import { defaultChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"
import { ChunkedEncoderBridge } from "@/workers/chunked-encoder-bridge"

const ENCODED_CHUNK_EVENT = "encoded-chunk"

/**
 * createStreamingExportPlugin：实时分片编码插件。
 *
 * 每帧 PCM 喂给指定格式的 ChunkedEncoder（经 ChunkedEncoderBridge），
 * 有产出时通过 "encoded-chunk" 事件发出。
 * Bridge 在 Worker 可用时将编码移入 Worker 线程，否则主线程同步降级。
 *
 * 用法：
 * ```ts
 * const plugin = createStreamingExportPlugin({ format: "mp3" })
 * recorder.use(plugin)
 * recorder.on("encoded-chunk", ({ payload }) => {
 *   // payload: StreamingChunkPayload
 * })
 * ```
 */
export function createStreamingExportPlugin(
  options: StreamingExportPluginOptions,
  registry: ChunkedEncoderRegistry = defaultChunkedEncoderRegistry
): RecorderPlugin {
  const { format, encoderOptions, allowMainThreadFallback } = options

  let bridge: ChunkedEncoderBridge | null = null
  let sequenceIndex = 0
  let isActive = false
  // sessionId 用于区分 stop 后异步回调是否属于当前 session，防止跨 session 的 chunk 发出
  let currentSessionId = 0
  let emitChunk: ((payload: StreamingChunkPayload) => void) | undefined

  function createBridge() {
    bridge?.dispose()
    bridge = new ChunkedEncoderBridge({
      format,
      encoderOptions,
      registry,
      allowMainThreadFallback,
    })
  }

  return {
    name: `streaming-export:${format}`,

    setup(context) {
      context.eventBus.register(ENCODED_CHUNK_EVENT)
      emitChunk = (payload) => {
        context.eventBus.emit(ENCODED_CHUNK_EVENT, payload)
      }
    },

    onStart() {
      createBridge()
      sequenceIndex = 0
      currentSessionId++
      isActive = true
    },

    onFrame(frame) {
      if (!isActive || bridge === null) {
        return
      }

      const capturedSeq = sequenceIndex++
      const capturedSessionId = currentSessionId

      // fire-and-forget：编码在 Worker / 主线程完成后回调 emit
      bridge
        .feedFrame(frame.channels, frame.sampleRate, frame.planar)
        .then((chunk) => {
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
      if (bridge === null) {
        return
      }

      const capturedSeq = sequenceIndex++
      const capturedSessionId = currentSessionId

      // flush 持有独立的 bridge 引用，dispose() 不会影响这个 Promise 的发起
      // dispose() 若在 flush Promise 解析前被调用，bridge 会 reject pending Promise，
      // catch 块会静默处理，isFinal chunk 丢失是可接受的（组件已卸载）
      bridge
        .flush()
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
      // 递增 sessionId 使所有在途 Promise 回调中的 capturedSessionId 不再匹配，
      // 确保 dispose 后不会再触发 emitChunk
      currentSessionId++
      bridge?.dispose()
      bridge = null
      emitChunk = undefined
    },
  }
}
