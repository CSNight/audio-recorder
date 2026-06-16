/**
 * ChunkedEncoder Worker 入口。
 *
 * 在 Worker 线程中接收主线程的消息，调用与主线程同一份 ChunkedEncoder 实现。
 * 不持有任何主线程引用，消息协议是唯一的通信接口。
 *
 * 消息协议：
 *   { type: "init",      format: string,    options?: unknown }
 *   { type: "feedFrame", planar: Int16Array[], channels: number, sampleRate: number, seqId: number }
 *   { type: "flush",     seqId: number }
 *   { type: "dispose" }
 *
 * 响应协议：
 *   { type: "result",    result: Uint8Array | null, seqId: number }
 *   { type: "error",     message: string,            seqId: number }
 */

// 导入 index.ts 的副作用，使默认注册表包含 PCM/WAV/MP3
// 与主线程保持一致，新增格式只需改 index.ts 一处
import "@/plugins/streaming-export/index"
import { defaultChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"
import type { ChunkedEncoder } from "@/plugins/streaming-export/types"

type WorkerIncomingMessage =
  | { type: "init"; format: string; options?: unknown }
  | {
      type: "feedFrame"
      planar: Int16Array[]
      channels: number
      sampleRate: number
      seqId: number
    }
  | { type: "flush"; seqId: number }
  | { type: "dispose" }

type WorkerOutgoingMessage =
  | { type: "result"; result: Uint8Array | null; seqId: number }
  | { type: "error"; message: string; seqId: number }

let encoder: ChunkedEncoder | null = null

function postMsg(msg: WorkerOutgoingMessage, transfer?: Transferable[]) {
  if (transfer) {
    ;(self as unknown as Worker).postMessage(msg, transfer)
  } else {
    ;(self as unknown as Worker).postMessage(msg)
  }
}

self.onmessage = (event: MessageEvent<WorkerIncomingMessage>) => {
  const msg = event.data

  if (msg.type === "init") {
    try {
      const definition = defaultChunkedEncoderRegistry.get(msg.format)
      encoder = definition.create(msg.options)
    } catch (err) {
      postMsg({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        seqId: -1,
      })
    }
    return
  }

  if (msg.type === "feedFrame") {
    if (encoder === null) {
      postMsg({
        type: "error",
        message:
          "ChunkedEncoder not initialized. Send an 'init' message first.",
        seqId: msg.seqId,
      })
      return
    }

    try {
      const result = encoder.feedFrame(msg.channels, msg.sampleRate, msg.planar)
      if (result !== null) {
        // 复制一份独立 buffer 再 transfer，避免 encoder 内部复用导致数据覆盖
        const copy = result.slice()
        postMsg({ type: "result", result: copy, seqId: msg.seqId }, [
          copy.buffer,
        ])
      } else {
        postMsg({ type: "result", result: null, seqId: msg.seqId })
      }
    } catch (err) {
      postMsg({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        seqId: msg.seqId,
      })
    }
    return
  }

  if (msg.type === "flush") {
    if (encoder === null) {
      postMsg({
        type: "error",
        message: "ChunkedEncoder not initialized.",
        seqId: msg.seqId,
      })
      return
    }

    try {
      const result = encoder.flush()
      if (result !== null) {
        const copy = result.slice()
        postMsg({ type: "result", result: copy, seqId: msg.seqId }, [
          copy.buffer,
        ])
      } else {
        postMsg({ type: "result", result: null, seqId: msg.seqId })
      }
    } catch (err) {
      postMsg({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        seqId: msg.seqId,
      })
    }
    return
  }

  if (msg.type === "dispose") {
    encoder?.dispose()
    encoder = null
  }
}
