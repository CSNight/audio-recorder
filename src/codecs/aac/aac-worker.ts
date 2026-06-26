import { createWorkerMessageHandler } from "@/workers/chunked-encoder-worker-core"
import { aacChunkedEncoderDefinition } from "./aac-chunked-encoder"

aacChunkedEncoderDefinition.preload?.()

self.onmessage = createWorkerMessageHandler(() => aacChunkedEncoderDefinition)
