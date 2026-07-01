/**
 * PCM 编解码器子路径导出入口（独立 Vite entry）。
 *
 * 导入此模块即可使用 pcmStreamEncoder：
 *   import { pcmStreamEncoder } from "@csnight/audio-recorder/codecs/base"
 *
 * 传入 createStreamingExportPlugin({ format: "pcm", encoders: [pcmStreamEncoder] })。
 */
import PcmWorker from "./pcm-worker.ts?worker"
import { pcmStreamEncoder } from "./pcm-chunked-encoder"
/**
 * WAV 编解码器插件入口（可选 Vite entry point）。
 *
 * 导出 wavStreamEncoder，供用户传入 createStreamingExportPlugin({ encoders: [...] }) 使用。
 * workerFactory 已设置为内联 WAV Worker blob。
 */
import WavWorker from "./wav-worker.ts?worker"
import { wavStreamEncoder } from "./wav-chunked-encoder"

pcmStreamEncoder.workerFactory = () => new PcmWorker()

export { pcmStreamEncoder }
export { pcmExportEncoder } from "./pcm-snapshot-encoder"
export { pcmDecoderDefinition } from "./pcm-decoder"
export type { PcmChunkedEncoderOptions } from "./pcm-chunked-encoder"
;(
  wavStreamEncoder as typeof wavStreamEncoder & {
    workerFactory?: () => Worker
  }
).workerFactory = () => new WavWorker()

export { wavStreamEncoder }

export { wavExportEncoder } from "./wav-snapshot-encoder"
export { wavDecoderDefinition } from "./wav-decoder"
export type { WavChunkedEncoderOptions } from "./wav-chunked-encoder"
