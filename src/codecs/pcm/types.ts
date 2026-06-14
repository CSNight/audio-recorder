import type { AudioChannelCount } from "@/types"

export interface PcmExportOptions {
  sampleRate?: number
  bitRate?: 8 | 16
}

export interface PcmExportResult {
  sampleRate: number
  channels: AudioChannelCount
  bitRate: 8 | 16
  durationMs: number
  data: Int16Array | Int8Array
}
