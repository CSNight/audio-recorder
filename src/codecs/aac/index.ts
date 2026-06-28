/**
 * AAC 编解码模块的 Vite 入口：通过 `?worker&inline` 注册内联 Worker 构造器，
 * 供 chunked encoder 在主线程降级前优先使用 Worker 编码。
 * WASM 模块预加载请参考 `src/index.ts`。
 */
import AacWorker from "./aac-worker.ts?worker"
import { aacChunkedEncoderDefinition } from "./aac-chunked-encoder"
;(
  aacChunkedEncoderDefinition as typeof aacChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = () => new AacWorker()

export { aacChunkedEncoderDefinition } from "./aac-chunked-encoder"
export { aacSnapshotEncoderDefinition } from "./aac-snapshot-exporter"
export type {
  AacEncoderHandle,
  AacEncoderOptions,
  AacExportOptions,
  AacExportResult,
} from "./types"
export { createAacEncoder } from "./aac-wasm-api"
