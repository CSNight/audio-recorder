import { exportPcmSnapshot } from "./pcm-exporter"
import type { PcmExportOptions, PcmExportResult } from "./pcm-types"
import type { ExportEncoderDefinition } from "../../types"
import { isSupportSampleRate } from "./sample-rate"

/** PCM 导出编码器：注册到 SnapshotEncoder 体系，直接复用 exportPcmSnapshot */
export const pcmExportEncoder: ExportEncoderDefinition<
  "pcm",
  PcmExportOptions,
  PcmExportResult
> = {
  type: "pcm",
  isSupportSampleRate,
  export: (snapshot, options) => exportPcmSnapshot(snapshot, options),
}
