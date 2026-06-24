/**
 * FLAC 编解码器插件入口（可选 Vite entry point）
 *
 * 用法：
 *   import { flacChunkedEncoderDefinition } from "audio-recorder/codecs/flac"
 *
 * 导入此文件会产生以下副作用：
 * 将 flacChunkedEncoderDefinition 的 workerFactory 指向 FLAC 专属 Worker blob。
 *
 * 该文件被设计为独立 Vite entry，FLAC WASM 依赖仅在此路径被用户明确导入时
 * 才会出现在产物中，不污染主包（src/index.ts）。
 *
 * 使用 streaming-export 的 FLAC 格式时，请将 flacChunkedEncoderDefinition 通过
 * options.encoders 传入 createStreamingExportPlugin，无需全局注册。
 */

import InlineFlacWorker from "./flac-worker.ts?worker&inline"
import { flacChunkedEncoderDefinition } from "./flac-chunked-encoder"

// 注入 Worker factory
;(
  flacChunkedEncoderDefinition as typeof flacChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = () => new InlineFlacWorker()

export { flacChunkedEncoderDefinition } from "./flac-chunked-encoder"
export { flacSnapshotEncoderDefinition } from "./flac-snapshot-exporter"
export type {
  FlacEncoderOptions,
  FlacExportOptions,
  FlacExportResult,
  FlacEncoderHandle,
} from "./types"
export { createFlacEncoder } from "./flac-wasm-api"
