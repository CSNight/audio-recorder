/** AAC 编码器选项 */
export interface AacEncoderOptions {
  sampleRate: number
  channels: number
  bitrate?: number
}

/** AAC 一次性导出选项 */
export interface AacExportOptions {
  bitrate?: number
  sampleRate?: number
}

/** AAC 一次性导出结果 */
export interface AacExportResult {
  data: Uint8Array
  mimeType: string
  sampleRate: number
  channels: number
  bitrate: number
}

/** AAC WASM 编码器实例句柄 */
export interface AacEncoderHandle {
  readonly sampleRate: number
  readonly channels: number
  readonly bitrate: number
  readonly frameSize: number
  /** ADTS/AudioSpecificConfig，部分容器（如 MP4）封装时需要 */
  readonly audioSpecificConfig: Uint8Array
  encode(pcm: Int16Array): Uint8Array[]
  flush(): Uint8Array[]
  free(): void
}

/** AAC 编码过程中抛出的错误，携带底层错误码与触发操作名 */
export class AacError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly operation: string
  ) {
    super(`${operation}: ${message}`)
    this.name = "AacError"
  }
}
