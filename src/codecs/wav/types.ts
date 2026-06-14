import type { AudioChannelCount } from "@/types"

export interface WavExportOptions {
  sampleRate?: number
  bitRate?: 8 | 16
}

export interface WavExportResult {
  sampleRate: number
  channels: AudioChannelCount
  bitRate: 8 | 16
  durationMs: number
  mimeType: "audio/wav"
  arrayBuffer: ArrayBuffer
  blob: Blob
}
