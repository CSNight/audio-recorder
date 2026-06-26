import { createWorkerMessageHandler } from "@/workers/chunked-encoder-worker-core"
import { amrChunkedEncoderDefinition } from "./amr-chunked-encoder"

amrChunkedEncoderDefinition.preload?.()

self.onmessage = createWorkerMessageHandler(() => amrChunkedEncoderDefinition)
