/**
 * G.711 编解码器插件入口（独立 Vite entry）。
 *
 * 用法：
 *   import { g711ChunkedEncoderDefinition } from "audio-recorder/codecs/g711"
 *
 * 导入此文件会为 g711ChunkedEncoderDefinition 注入 workerFactory，
 * G.711 算法代码内联为 Worker blob，不污染主包。
 */
import InlineG711Worker from "./g711-worker.ts?worker&inline"
import { g711ChunkedEncoderDefinition } from "./g711-chunked-encoder"
;(
  g711ChunkedEncoderDefinition as typeof g711ChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = () => new InlineG711Worker()

export { g711ChunkedEncoderDefinition } from "./g711-chunked-encoder"
export { g711SnapshotEncoderDefinition } from "./g711-snapshot-exporter"
export type { G711ChunkedEncoderOptions, G711ExportOptions, G711ExportResult } from "./types"
