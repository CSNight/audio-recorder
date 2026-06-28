/**
 * MP3 ??????????? Vite entry point??
 *
 * ??????????????
 * ? mp3ChunkedEncoderDefinition ? workerFactory ?? MP3 ?? Worker blob?
 *
 * ????????? Vite entry?MP3 WASM ???????????????
 * ???????????????src/index.ts??
 *
 * ?? streaming-export ? MP3 ?????? mp3ChunkedEncoderDefinition ??
 * options.encoders ?? createStreamingExportPlugin????????
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
