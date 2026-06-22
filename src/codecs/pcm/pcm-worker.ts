/**
 * PCM 专属 ChunkedEncoder Worker 入口。
 *
 * 静态绑定 pcmChunkedEncoderDefinition，不经过任何注册表查找。
 * 该文件仅在用户显式 import "audio-recorder/codecs/pcm" 时，
 * 由 Vite 打包为独立的 Worker blob（?worker&inline）。
 *
 * 消息循环逻辑见 @/workers/chunked-encoder-worker-core.ts（被所有 Worker 入口共用）。
 */
import { pcmChunkedEncoderDefinition } from "./pcm-chunked-encoder"
import { createWorkerMessageHandler } from "@/workers/chunked-encoder-worker-core"

self.onmessage = createWorkerMessageHandler(() => pcmChunkedEncoderDefinition)
