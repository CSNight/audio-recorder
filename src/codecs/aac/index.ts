import InlineAacWorker from "./aac-worker.ts?worker&inline"
import { aacChunkedEncoderDefinition } from "./aac-chunked-encoder"
;(
  aacChunkedEncoderDefinition as typeof aacChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = () => new InlineAacWorker()

export { aacChunkedEncoderDefinition } from "./aac-chunked-encoder"
export { aacSnapshotEncoderDefinition } from "./aac-snapshot-exporter"
export type {
  AacEncoderHandle,
  AacEncoderOptions,
  AacExportOptions,
  AacExportResult,
} from "./types"
export { createAacEncoder } from "./aac-wasm-api"
