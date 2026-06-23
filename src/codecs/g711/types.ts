export type G711Variant = "alaw" | "ulaw"

export interface G711ChunkedEncoderOptions {
  variant?: G711Variant
}

export interface G711ExportOptions {
  variant?: G711Variant
  sampleRate?: number
}

export interface G711ExportResult {
  variant: G711Variant
  sampleRate: number
  channels: 1
  durationMs: number
  data: Uint8Array
}
