import type {
  StreamEncoderDefinition,
  StreamingExportFormat,
} from "../../types"

/** createStreamingExportPlugin 的选项 */
export interface StreamingExportPluginOptions {
  format: StreamingExportFormat
  encoderOptions?: unknown
  /**
   * 要使用的编码器定义列表。
   * 用户必须显式传入对应格式的 StreamEncoderDefinition，例如：
   *   import { pcmStreamEncoder } from "@media-studio/audio-recorder/codecs/base"
   *   createStreamingExportPlugin({ format: "pcm", encoders: [pcmStreamEncoder] })
   */
  encoders: StreamEncoderDefinition[]
  /** Worker 编码不可用时是否允许降级到主线程同步编码，默认 true */
  allowMainThreadFallback?: boolean
  /** 逻辑流 ID。未传时优先走 createStreamId()，否则按默认规则生成。 */
  streamId?: string
  /** 附加到每个 packet 的静态外层元数据。 */
  metadata?: Record<string, unknown>

  /** 懒生成逻辑流 ID，只在 plugin 实例初始化时调用一次。 */
  createStreamId?(): string

  /** 每次 onStart() 时生成新的会话 ID。 */
  createSessionId?(): string
}
