/**
 * Opus 编解码器插件入口（可选 Vite entry point）
 *
 * 用法：
 *   import { oggChunkedEncoderDefinition } from "audio-recorder/codecs/opus"
 *   import { webmChunkedEncoderDefinition } from "audio-recorder/codecs/opus"
 *
 * 导入此文件会产生以下副作用：
 * 将 oggChunkedEncoderDefinition 和 webmChunkedEncoderDefinition 的 workerFactory
 * 指向 Opus 专属 Worker blob。
 *
 * 该文件被设计为独立 Vite entry，Opus WASM 和 muxer 依赖仅在此路径被用户明确导入时
 * 才会出现在产物中，不污染主包（src/index.ts）。
 *
 * 使用 streaming-export 的 Opus 格式时，请将 oggChunkedEncoderDefinition 或
 * webmChunkedEncoderDefinition 通过 options.encoders 传入 createStreamingExportPlugin，
 * 无需全局注册。
 */

import OpusWorker from "./opus-worker.ts?worker"
import {
  oggChunkedEncoderDefinition,
  webmChunkedEncoderDefinition,
} from "./opus-chunked-encoder"

// 注入 Worker factory（OGG 和 WebM 共用同一个 Worker）
const makeWorker = () => new OpusWorker()

;(
  oggChunkedEncoderDefinition as typeof oggChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = makeWorker
;(
  webmChunkedEncoderDefinition as typeof webmChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = makeWorker

export {
  oggChunkedEncoderDefinition,
  webmChunkedEncoderDefinition,
} from "./opus-chunked-encoder"
export {
  oggSnapshotEncoderDefinition,
  webmSnapshotEncoderDefinition,
} from "./opus-snapshot-exporter"
export type {
  OpusEncoderOptions,
  OpusDecoderOptions,
  OpusExportOptions,
  OpusExportResult,
  OpusEncoderHandle,
  OpusDecoderHandle,
} from "./types"
export { createOpusEncoder, createOpusDecoder } from "./opus-wasm-api"
