import { exportPcmSnapshot } from "@/codecs/pcm/pcm-exporter"
import type { PcmExportOptions, PcmExportResult } from "@/codecs/pcm/types"
import type { SnapshotEncoderDefinition } from "@/encoders/encoder-registry"

export function createPcmEncoder(): SnapshotEncoderDefinition<
  "pcm",
  PcmExportOptions,
  PcmExportResult
> {
  return {
    type: "pcm",
    export: (snapshot, options) => exportPcmSnapshot(snapshot, options),
  }
}

export type { PcmExportOptions, PcmExportResult } from "@/codecs/pcm/types"
