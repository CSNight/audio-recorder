import InlineAmrWorker from "./amr-worker.ts?worker&inline"
import { amrChunkedEncoderDefinition } from "./amr-chunked-encoder"
;(
  amrChunkedEncoderDefinition as typeof amrChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = () => new InlineAmrWorker()

export { amrChunkedEncoderDefinition } from "./amr-chunked-encoder"
export { amrSnapshotEncoderDefinition } from "./amr-snapshot-exporter"
export type {
  AmrBandMode,
  AmrEncoderHandle,
  AmrEncoderOptions,
  AmrExportOptions,
  AmrExportResult,
} from "./types"
export { createAmrEncoder } from "./amr-wasm-api"
