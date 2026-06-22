import { exportWavSnapshot } from "./wav-exporter"
import type { WavExportOptions, WavExportResult } from "./types"
import type { SnapshotEncoderDefinition } from "@/types"

export const wavSnapshotEncoderDefinition: SnapshotEncoderDefinition<
  "wav",
  WavExportOptions,
  WavExportResult
> = {
  type: "wav",
  export: (snapshot, options) => exportWavSnapshot(snapshot, options),
}
