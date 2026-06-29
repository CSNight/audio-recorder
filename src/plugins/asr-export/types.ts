import type { SnapshotEncoderDefinition } from "@/types"

export type AsrExportFormat = "pcm" | "wav"

export interface AsrChunkPayload {
  format: AsrExportFormat
  chunk: Uint8Array
  sequenceIndex: number
  timestampMs: number
  durationMs: number
  sampleRate: number
  channels: 1
  isFinal: boolean
}

export interface AsrExportPluginOptions {
  format?: AsrExportFormat
  encoders: SnapshotEncoderDefinition[]
  sampleRate?: 8000 | 16000 | 24000 | 32000 | 48000
  channels?: 1
  chunkDurationMs?: number
  bitsPerSample?: 16
}
