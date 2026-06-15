import { exportWavSnapshot } from "@/codecs/wav/wav-exporter"
import type { WavExportOptions, WavExportResult } from "@/codecs/wav/types"
import type { SnapshotEncoderDefinition } from "@/encoders/encoder-registry"

export function createWavEncoder(): SnapshotEncoderDefinition<
  "wav",
  WavExportOptions,
  WavExportResult
> {
  return {
    type: "wav",
    export: (snapshot, options) => exportWavSnapshot(snapshot, options),
  }
}

export type { WavExportOptions, WavExportResult } from "@/codecs/wav/types"
