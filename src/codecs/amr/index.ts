/**
 * AMR 编解码器 Vite 入口。
 * 通过 `?worker&inline` 将 AMR Worker 以 blob URL 形式内联注册，
 * 避免单独的 worker 文件依赖。WASM 预加载请参见 `src/index.ts`。
 */
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
