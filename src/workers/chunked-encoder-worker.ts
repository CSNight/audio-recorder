/**
 * 默认 ChunkedEncoder Worker 入口（PCM / WAV）。
 *
 * 仅显式注册 PCM、WAV 两种编码器到本 Worker 内部的注册表实例——
 * 不再 import "@/plugins/streaming-export/index" 的全量副作用，
 * 因为该入口会间接拖入 MP3 编码器（及其 lamejs 依赖），
 * 与"默认 Worker 不包含 MP3/体积较大的可选编解码器"的设计目标相悖。
 *
 * MP3 等可选编解码器拥有各自独立的 Worker 入口（见 src/codecs/mp3/mp3-worker.ts），
 * 该入口仅在用户显式从 `audio-recorder/codecs/mp3` 导入时才会被打包进产物。
 *
 * 消息循环逻辑见 ./chunked-encoder-worker-core.ts（被所有 Worker 入口共用）。
 */
import { pcmChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/pcm"
import { wavChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/wav"
import { defaultChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"

defaultChunkedEncoderRegistry.register(pcmChunkedEncoderDefinition)
defaultChunkedEncoderRegistry.register(wavChunkedEncoderDefinition)

// 注册完成后再挂载消息循环
import "./chunked-encoder-worker-core"
