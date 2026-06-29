/**
 * PCM 编解码器子路径导出入口（独立 Vite entry）。
 *
 * 导入此模块即可使用 pcmChunkedEncoderDefinition：
 *   import { pcmChunkedEncoderDefinition } from "audio-recorder/codecs/pcm"
 *
 * 传入 createStreamingExportPlugin({ format: "pcm", encoders: [pcmChunkedEncoderDefinition] })。
 */
import PcmWorker from "./pcm-worker.ts?worker"
import { pcmChunkedEncoderDefinition } from "./pcm-chunked-encoder"
/**
 * WAV 编解码器插件入口（可选 Vite entry point）。
 *
 * 导出 wavChunkedEncoderDefinition，供用户传入 createStreamingExportPlugin({ encoders: [...] }) 使用。
 * workerFactory 已设置为内联 WAV Worker blob。
 */
import WavWorker from "./wav-worker.ts?worker"
import { wavChunkedEncoderDefinition } from "./wav-chunked-encoder"

pcmChunkedEncoderDefinition.workerFactory = () => new PcmWorker()

export { pcmChunkedEncoderDefinition }
export { pcmSnapshotEncoderDefinition } from "./pcm-snapshot-encoder"
export { pcmDecoderDefinition } from "./pcm-decoder"
export type { PcmChunkedEncoderOptions } from "./pcm-chunked-encoder"
;(
  wavChunkedEncoderDefinition as typeof wavChunkedEncoderDefinition & {
    workerFactory?: () => Worker
  }
).workerFactory = () => new WavWorker()

export { wavChunkedEncoderDefinition }

export { wavSnapshotEncoderDefinition } from "./wav-snapshot-encoder"
export { wavDecoderDefinition } from "./wav-decoder"
export type { WavChunkedEncoderOptions } from "./wav-chunked-encoder"
