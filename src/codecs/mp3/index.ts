/**
 * MP3 编解码器插件入口（可选 Vite entry point）。
 *
 * 用法：
 *   import { createMp3Encoder } from "audio-recorder/codecs/mp3"
 *
 * 导入此文件会产生以下副作用：
 * 1. 将 MP3 ChunkedEncoder 注册到默认注册表（defaultChunkedEncoderRegistry）
 * 2. 将 mp3ChunkedEncoderDefinition 的 workerFactory 指向 MP3 专属 Worker blob
 *
 * 同时导出 createMp3Encoder()，供消费方调用 recorder.registerEncoder(createMp3Encoder())
 * 以启用 recorder.exportEncoded("mp3") / recorder.exportEncoded<Mp3ExportOptions, Mp3ExportResult>("mp3") 路径。
 *
 * 该文件被设计为独立 Vite entry，lamejs 依赖仅在此路径被用户明确导入时
 * 才会出现在产物中，不污染主包（src/index.ts）。
 */
import InlineMp3Worker from "./mp3-worker.ts?worker&inline"
import { mp3ChunkedEncoderDefinition } from "./mp3-chunked-encoder"
import { defaultChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"
import type { SnapshotEncoderDefinition } from "@/encoders/encoder-registry"
import type { Mp3ExportOptions, Mp3ExportResult } from "./mp3-snapshot-types"
import { exportMp3Snapshot } from "./mp3-snapshot-exporter"
;(
  mp3ChunkedEncoderDefinition as typeof mp3ChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = () => new InlineMp3Worker()

// 注册到默认注册表（幂等：重复注册覆盖同 format 的旧定义）
defaultChunkedEncoderRegistry.register(mp3ChunkedEncoderDefinition)

/**
 * 创建 MP3 快照编码器定义，供 recorder.registerEncoder() 使用。
 * 调用后即可通过 recorder.exportEncoded("mp3", options) 导出完整 MP3 文件。
 */
export function createMp3Encoder(): SnapshotEncoderDefinition<
  "mp3",
  Mp3ExportOptions,
  Mp3ExportResult
> {
  return {
    type: "mp3",
    export: (snapshot, options) => exportMp3Snapshot(snapshot, options),
  }
}

export { exportMp3Snapshot } from "./mp3-snapshot-exporter"
export type { Mp3ExportOptions, Mp3ExportResult } from "./mp3-snapshot-types"
export type { Mp3ChunkedEncoderOptions } from "./mp3-chunked-encoder"
