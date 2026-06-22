/**
 * MP3 专属 ChunkedEncoder Worker 入口。
 *
 * 静态绑定 mp3ChunkedEncoderDefinition，无需注册表。
 * 消息循环逻辑见 ../../workers/chunked-encoder-worker-core.ts。
 */
import { mp3ChunkedEncoderDefinition } from "./mp3-chunked-encoder"
import { createWorkerMessageHandler } from "@/workers/chunked-encoder-worker-core"

self.onmessage = createWorkerMessageHandler(() => mp3ChunkedEncoderDefinition)
