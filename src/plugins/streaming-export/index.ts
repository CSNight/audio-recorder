/**
 * streaming-export 子路径导出入口。
 *
 * 预注册 PCM、WAV、MP3 三种 ChunkedEncoder 格式到默认注册表，
 * 导入此模块即可直接使用 createStreamingExportPlugin({ format: "pcm"|"wav"|"mp3" })。
 */
export { createStreamingExportPlugin } from "@/plugins/streaming-export/plugin"
export {
  ChunkedEncoderRegistry,
  defaultChunkedEncoderRegistry,
} from "@/plugins/streaming-export/registry"
export type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
  StreamingChunkPayload,
  StreamingExportPluginOptions,
} from "@/plugins/streaming-export/types"
export type { PcmChunkedEncoderOptions } from "@/plugins/streaming-export/encoders/pcm"
export type { WavChunkedEncoderOptions } from "@/plugins/streaming-export/encoders/wav"
export type { Mp3ChunkedEncoderOptions } from "@/plugins/streaming-export/encoders/mp3"

// 注册内置编码器到默认注册表
import { pcmChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/pcm"
import { wavChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/wav"
import { mp3ChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/mp3"
import { defaultChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"

defaultChunkedEncoderRegistry.register(pcmChunkedEncoderDefinition)
defaultChunkedEncoderRegistry.register(wavChunkedEncoderDefinition)
defaultChunkedEncoderRegistry.register(mp3ChunkedEncoderDefinition)
