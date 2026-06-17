/**
 * streaming-export 子路径导出入口。
 *
 * 预注册 PCM、WAV 两种 ChunkedEncoder 格式到默认注册表。
 * MP3 等可选编解码器需显式导入 `audio-recorder/codecs/mp3` 才会注册。
 *
 * 导入此模块即可直接使用 createStreamingExportPlugin({ format: "pcm"|"wav" })。
 * 使用 MP3 时额外执行：import "audio-recorder/codecs/mp3"。
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

// 注册内置编码器到默认注册表（仅 PCM / WAV）
import { pcmChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/pcm"
import { wavChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/wav"
import { defaultChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"

defaultChunkedEncoderRegistry.register(pcmChunkedEncoderDefinition)
defaultChunkedEncoderRegistry.register(wavChunkedEncoderDefinition)
