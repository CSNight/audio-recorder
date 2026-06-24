/**
 * Opus 专属 ChunkedEncoder Worker 入口
 *
 * 支持两种格式：
 * - opus-ogg: Opus in OGG container
 * - opus-webm: Opus in WebM container
 *
 * 消息循环逻辑见 ../../workers/chunked-encoder-worker-core.ts
 */
import {
  opusOggChunkedEncoderDefinition,
  opusWebmChunkedEncoderDefinition,
} from "./opus-chunked-encoder"
import { createWorkerMessageHandler } from "@/workers/chunked-encoder-worker-core"

// 根据 format 选择对应的 encoder definition
self.onmessage = createWorkerMessageHandler((format) => {
  if (format === "opus-ogg") {
    return opusOggChunkedEncoderDefinition
  } else if (format === "opus-webm") {
    return opusWebmChunkedEncoderDefinition
  }
  throw new Error(`Unknown Opus format: ${format}`)
})
