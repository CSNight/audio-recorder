export type Ac3Codec = "ac3" | "eac3"

export type Ac3SampleRate = 16000 | 22050 | 24000 | 32000 | 44100 | 48000

export interface Ac3ExportOptions {
  codec?: Ac3Codec
  bitrate?: number
  sampleRate?: Ac3SampleRate
  /** 是否使用高保真重采样算法，默认 false（仅 sampleRate 触发重采样时生效） */
  isHQ?: boolean
}

export interface Ac3EncoderOptions {
  codec?: Ac3Codec
  sampleRate: Ac3SampleRate
  channels: number
  bitrate?: number
}

export interface ResolvedAc3EncoderOptions {
  codec: Ac3Codec
  sampleRate: Ac3SampleRate
  channels: number
  bitrate: number
}

export interface Ac3EncoderHandle {
  readonly codec: Ac3Codec
  readonly sampleRate: Ac3SampleRate
  readonly channels: number
  readonly bitrate: number
  readonly frameSize: number
  encode(pcm: Int16Array): Uint8Array[]
  flush(): Uint8Array[]
  free(): void
}

export interface Ac3ExportResult {
  data: Uint8Array
  mimeType: string
  codec: Ac3Codec
  sampleRate: Ac3SampleRate
  channels: number
  bitrate: number
}

export class Ac3Error extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly operation: string
  ) {
    super(`${operation}: ${message}`)
    this.name = "Ac3Error"
  }
}
