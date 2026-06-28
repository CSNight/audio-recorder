/**
 * MP3 专属 ChunkedEncoder Worker 入口。
 *
 * 静态绑定 mp3ChunkedEncoderDefinition，无需注册表。
 * 消息循环逻辑见 ../../workers/chunked-encoder-worker-core.ts。
 */
import { mp3ChunkedEncoderDefinition } from "./mp3-chunked-encoder"
import { createWorkerMessageHandler } from "@/workers/chunked-encoder-worker-core"
// Worker 模块加载时立即预热 WASM（与主线程 setup() 的 preload 并行，各自独立模块实例）
mp3ChunkedEncoderDefinition.preload?.()
self.onmessage = createWorkerMessageHandler(() => mp3ChunkedEncoderDefinition)
