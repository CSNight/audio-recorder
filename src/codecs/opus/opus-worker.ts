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

// Worker 模块加载时立即预热 WASM（与主线程 setup() 的 preload 并行，各自独立模块实例）
// 两个 definition 底层共享同一个 preloadOpusModule 单例，均调用以保持与 flac-worker.ts 对称、不依赖隐含共享关系
opusOggChunkedEncoderDefinition.preload?.()
opusWebmChunkedEncoderDefinition.preload?.()

// 根据 format 选择对应的 encoder definition
self.onmessage = createWorkerMessageHandler((format) => {
  if (format === "opus-ogg") {
    return opusOggChunkedEncoderDefinition
  } else if (format === "opus-webm") {
    return opusWebmChunkedEncoderDefinition
  }
  throw new Error(`Unknown Opus format: ${format}`)
})
