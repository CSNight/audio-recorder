/**
 * FLAC 专属 ChunkedEncoder Worker 入口
 *
 * 静态绑定 flacChunkedEncoderDefinition，无需注册表。
 * 消息循环逻辑见 ../../workers/chunked-encoder-worker-core.ts。
 */
import { flacChunkedEncoderDefinition } from "./flac-chunked-encoder"
import { createWorkerMessageHandler } from "@/workers/chunked-encoder-worker-core"

self.onmessage = createWorkerMessageHandler(() => flacChunkedEncoderDefinition)
