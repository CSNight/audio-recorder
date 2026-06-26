export type AmrBandMode = "nb" | "wb"

export interface AmrEncoderOptions {
  bandMode?: AmrBandMode
}

export type AmrExportOptions = AmrEncoderOptions

export interface AmrExportResult {
  data: Uint8Array
  mimeType: string
  bandMode: AmrBandMode
  sampleRate: 8000 | 16000
  channels: 1
  durationMs: number
}

export interface AmrEncoderHandle {
  readonly bandMode: AmrBandMode
  readonly sampleRate: 8000 | 16000
  readonly frameSize: 160 | 320
  encode(frame: Int16Array): Uint8Array
  free(): void
}
