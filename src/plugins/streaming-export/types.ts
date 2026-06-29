/**
 * StreamingExportPlugin 相关类型定义。
 *
 * StreamEncoder 是编码分片逻辑的纯函数单元：
 * - 不持有任何浏览器 API 引用
 * - 可在 Worker 和主线程中直接实例化，使用同一份代码
 */

/** 实时编码块的事件 payload，通过 "encoded-chunk" 事件发出 */
export interface StreamingChunkPayload {
  chunk: Uint8Array
  format: StreamingExportFormat
  timestampMs: number
  sequenceIndex: number
  sampleRate: number
  channels: number
  /** true 表示本次 session 的最后一个 chunk（flush 产物） */
  isFinal: boolean
}

export type StreamingExportFormat = "pcm" | "wav"

/**
 * StreamEncoder：编码分片逻辑的统一封装，只写一次，Worker 和主线程共用。
 * 不持有任何浏览器 API 引用，可安全在 Worker 上下文中执行。
 */
export interface StreamEncoder {
  /** 接收一帧 PCM 数据，返回当前可产出的编码块（无产出时返回 null） */
  feedFrame(
    channels: number,
    sampleRate: number,
    planar: Int16Array[]
  ): Uint8Array | null
  /** 录音结束时冲刷剩余缓冲，返回最终块（无剩余时返回 null） */
  flush(): Uint8Array | null
  /** 释放内部资源 */
  dispose(): void
}

/** StreamEncoder 工厂定义 */
export interface StreamEncoderDefinition<TOptions = unknown> {
  format: string
  /**
   * 可选：为本编码器创建专属 Worker 实例的工厂函数。
   * 未提供时退回主线程同步编码。
   * MP3 等可选编解码器提供此字段，以便将 WASM 模块等重型依赖隔离到独立 Worker blob 中。
   */
  workerFactory?: () => Worker

  /**
   * 【可选】预加载编码器所需资源（如 WASM 模块）。
   * 幂等，可多次调用，内部由单例 Promise 保证只加载一次。
   * 无 WASM 依赖的编码器（PCM/WAV/MP3/G711）无需实现此方法。
   *
   * 在 plugin.setup() 中调用，保证 create() 调用时模块已就绪。
   */
  preload?(): Promise<void>

  /**
   * 同步创建 StreamEncoder 实例，可接收格式相关选项（bitrate、framesPerChunk 等）。
   * 对于有 WASM 依赖的编码器，调用前必须已执行 preload()。
   */
  create(options?: TOptions): StreamEncoder
}

/** createStreamingExportPlugin 的选项 */
export interface StreamingExportPluginOptions {
  format: StreamingExportFormat
  encoderOptions?: unknown
  /**
   * 要使用的编码器定义列表。
   * 用户必须显式传入对应格式的 StreamEncoderDefinition，例如：
   *   import { pcmStreamEncoder } from "audio-recorder/codecs/pcm"
   *   createStreamingExportPlugin({ format: "pcm", encoders: [pcmStreamEncoder] })
   */
  encoders: StreamEncoderDefinition[]
  /** Worker 编码不可用时是否允许降级到主线程同步编码，默认 true */
  allowMainThreadFallback?: boolean
}
