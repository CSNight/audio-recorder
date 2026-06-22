/**
 * StreamingExportPlugin 相关类型定义。
 *
 * ChunkedEncoder 是编码分片逻辑的纯函数单元：
 * - 不持有任何浏览器 API 引用
 * - 可在 Worker 和主线程中直接实例化，使用同一份代码
 */

/** 实时编码块的事件 payload，通过 "encoded-chunk" 事件发出 */
export interface StreamingChunkPayload {
  chunk: Uint8Array
  format: string
  timestampMs: number
  sequenceIndex: number
  /** true 表示本次 session 的最后一个 chunk（flush 产物） */
  isFinal: boolean
}

/**
 * ChunkedEncoder：编码分片逻辑的统一封装，只写一次，Worker 和主线程共用。
 * 不持有任何浏览器 API 引用，可安全在 Worker 上下文中执行。
 */
export interface ChunkedEncoder {
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

/** ChunkedEncoder 工厂定义 */
export interface ChunkedEncoderDefinition<TOptions = unknown> {
  format: string
  /**
   * 可选：为本编码器创建专属 Worker 实例的工厂函数。
   * 未提供时退回主线程同步编码。
   * MP3 等可选编解码器提供此字段，以便将 lamejs 等重型依赖隔离到独立 Worker blob 中。
   */
  workerFactory?: () => Worker

  /** 创建 ChunkedEncoder 实例，可接收格式相关选项（bitrate、framesPerChunk 等） */
  create(options?: TOptions): ChunkedEncoder
}

/** createStreamingExportPlugin 的选项 */
export interface StreamingExportPluginOptions {
  format: string
  encoderOptions?: unknown
  /**
   * 要使用的编码器定义列表。
   * 用户必须显式传入对应格式的 ChunkedEncoderDefinition，例如：
   *   import { pcmChunkedEncoderDefinition } from "audio-recorder/codecs/pcm"
   *   createStreamingExportPlugin({ format: "pcm", encoders: [pcmChunkedEncoderDefinition] })
   */
  encoders: ChunkedEncoderDefinition[]
  /** Worker 编码不可用时是否允许降级到主线程同步编码，默认 true */
  allowMainThreadFallback?: boolean
}
