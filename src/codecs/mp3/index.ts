/**
 * MP3 编解码器的 Vite 入口文件。
 *
 * 职责：将 Worker 工厂函数挂载到 mp3ChunkedEncoderDefinition：
 * 为 mp3ChunkedEncoderDefinition 添加 workerFactory，生成 MP3 专属 Worker blob。
 *
 * 此文件应作为单独的 Vite entry，使 MP3 WASM 模块与主 bundle 分离，按需加载，
 * 避免污染 src/index.ts 主入口。
 *
 * 使用 streaming-export 的 MP3 流式编码时，将 mp3ChunkedEncoderDefinition 传入
 * options.encoders 后交由 createStreamingExportPlugin 使用即可。
 */
import InlineMp3Worker from "./mp3-worker.ts?worker&inline"
import { mp3ChunkedEncoderDefinition } from "./mp3-chunked-encoder"
;(
  mp3ChunkedEncoderDefinition as typeof mp3ChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = () => new InlineMp3Worker()

export { mp3ChunkedEncoderDefinition } from "./mp3-chunked-encoder"
export { mp3SnapshotEncoderDefinition } from "./mp3-snapshot-exporter"
export type { Mp3ChunkedEncoderOptions } from "./mp3-chunked-encoder"
export type {
  Mp3ChannelMode,
  Mp3EncoderOptions,
  Mp3ExportOptions,
  Mp3ExportResult,
  Mp3RateMode,
  Mp3SampleRate,
} from "./types"
export { createMp3Encoder, preloadMp3Module } from "./mp3-wasm-api"
