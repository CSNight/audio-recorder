export interface AacEncoderOptions {
  sampleRate: number
  channels: number
  bitrate?: number
}

export interface AacExportOptions {
  bitrate?: number
  sampleRate?: number
}

export interface AacExportResult {
  data: Uint8Array
  mimeType: string
  sampleRate: number
  channels: number
  bitrate: number
}

export interface AacEncoderHandle {
  readonly sampleRate: number
  readonly channels: number
  readonly bitrate: number
  readonly frameSize: number
  readonly audioSpecificConfig: Uint8Array
  encode(pcm: Int16Array): Uint8Array[]
  flush(): Uint8Array[]
  free(): void
}

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
