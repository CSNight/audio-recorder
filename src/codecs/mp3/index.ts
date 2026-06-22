/**
 * MP3 编解码器插件入口（可选 Vite entry point）。
 *
 * 用法：
 *   import { createMp3Encoder } from "audio-recorder/codecs/mp3"
 *
 * 导入此文件会产生以下副作用：
 * 将 mp3ChunkedEncoderDefinition 的 workerFactory 指向 MP3 专属 Worker blob。
 *
 * 同时导出 createMp3Encoder()，供消费方调用 recorder.registerEncoder(createMp3Encoder())
 * 以启用 recorder.exportEncoded("mp3") 路径。
 *
 * 该文件被设计为独立 Vite entry，lamejs 依赖仅在此路径被用户明确导入时
 * 才会出现在产物中，不污染主包（src/index.ts）。
 *
 * 使用 streaming-export 的 MP3 格式时，请将 mp3ChunkedEncoderDefinition 通过
 * options.encoders 传入 createStreamingExportPlugin，无需全局注册。
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
