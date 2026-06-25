import { exportPcmSnapshot } from "./pcm-exporter"
import type { PcmExportOptions, PcmExportResult } from "./pcm-types"
import type { SnapshotEncoderDefinition } from "@/types"

export const pcmSnapshotEncoderDefinition: SnapshotEncoderDefinition<
  "pcm",
  PcmExportOptions,
  PcmExportResult
> = {
  type: "pcm",
  export: async (snapshot, options) => exportPcmSnapshot(snapshot, options),
}
