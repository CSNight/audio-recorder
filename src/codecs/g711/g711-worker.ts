/**
 * G.711 专属 ChunkedEncoder Worker 入口。
 */
import { g711ChunkedEncoderDefinition } from "./g711-chunked-encoder"
import { createWorkerMessageHandler } from "@/workers/chunked-encoder-worker-core"

self.onmessage = createWorkerMessageHandler(() => g711ChunkedEncoderDefinition)
