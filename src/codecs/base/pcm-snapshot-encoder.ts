import { exportPcmSnapshot } from "./pcm-exporter"
import type { PcmExportOptions, PcmExportResult } from "./pcm-types"
import type { SnapshotEncoderDefinition } from "@/types"

/** PCM 快照编码器定义：注册到 SnapshotEncoder 体系，直接复用 exportPcmSnapshot */
export const pcmSnapshotEncoderDefinition: SnapshotEncoderDefinition<
  "pcm",
  PcmExportOptions,
  PcmExportResult
> = {
  type: "pcm",
  export: (snapshot, options) => exportPcmSnapshot(snapshot, options),
}
