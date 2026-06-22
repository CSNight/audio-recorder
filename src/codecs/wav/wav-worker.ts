import { wavChunkedEncoderDefinition } from "./wav-chunked-encoder"
import { createWorkerMessageHandler } from "@/workers/chunked-encoder-worker-core"

self.onmessage = createWorkerMessageHandler(() => wavChunkedEncoderDefinition)
