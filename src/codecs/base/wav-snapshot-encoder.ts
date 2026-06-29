import { exportWavSnapshot } from "./wav-exporter"
import type { WavExportOptions, WavExportResult } from "./wav-types"
import type { ExportEncoderDefinition } from "@/types"

export const wavExportEncoder: ExportEncoderDefinition<
  "wav",
  WavExportOptions,
  WavExportResult
> = {
  type: "wav",
  export: (snapshot, options) => exportWavSnapshot(snapshot, options),
}
