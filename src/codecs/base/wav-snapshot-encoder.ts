import { exportWavSnapshot } from "./wav-exporter"
import type { WavExportOptions, WavExportResult } from "./wav-types"
import type { ExportEncoderDefinition } from "../../types"
import { isSupportSampleRate } from "./sample-rate"

export const wavExportEncoder: ExportEncoderDefinition<
  "wav",
  WavExportOptions,
  WavExportResult
> = {
  type: "wav",
  isSupportSampleRate,
  export: (snapshot, options) => exportWavSnapshot(snapshot, options),
}
