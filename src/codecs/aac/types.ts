export type AacSampleRate =
  | 7350
  | 8000
  | 11025
  | 12000
  | 16000
  | 22050
  | 24000
  | 32000
  | 44100
  | 48000
  | 64000
  | 88200
  | 96000

/** AAC 编码器选项 */
export interface AacEncoderOptions {
  sampleRate: AacSampleRate
  channels: number
  bitrate?: number
}

/** AAC 一次性导出选项 */
export interface AacExportOptions {
  bitrate?: number
  sampleRate?: AacSampleRate
  /** 是否使用高保真重采样算法，默认 false（仅 sampleRate 触发重采样时生效） */
  isHQ?: boolean
}

/** AAC 一次性导出结果 */
export interface AacExportResult {
  data: Uint8Array
  mimeType: string
  sampleRate: AacSampleRate
  channels: number
  bitrate: number
}

/** AAC WASM 编码器实例句柄 */
export interface AacEncoderHandle {
  readonly sampleRate: AacSampleRate
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
