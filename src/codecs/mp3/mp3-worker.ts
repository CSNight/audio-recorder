/**
 * MP3 专属 ChunkedEncoder Worker 入口。
 *
 * 仅注册 MP3 编码器到本 Worker 内部的注册表实例。
 * 与默认 Worker（chunked-encoder-worker.ts）完全隔离——
 * 各自拥有独立的模块作用域和注册表实例，互不影响。
 *
 * 该文件仅在用户显式 import 'audio-recorder/codecs/mp3' 时，
 * 由 Vite 打包为独立的 Worker blob（?worker&inline）。
 *
 * 消息循环逻辑见 ../../workers/chunked-encoder-worker-core.ts（被所有 Worker 入口共用）。
 */
import { mp3ChunkedEncoderDefinition } from "./mp3-chunked-encoder"
import { defaultChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"
// 注册完成后再挂载消息循环
import "@/workers/chunked-encoder-worker-core"

defaultChunkedEncoderRegistry.register(mp3ChunkedEncoderDefinition)
