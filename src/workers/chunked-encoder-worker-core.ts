/**
 * ChunkedEncoder Worker 消息循环核心。
 *
 * 被所有 Worker 入口文件（chunked-encoder-worker.ts、mp3-worker.ts 等）共用：
 * 每个入口在 import 此文件之前，先完成各自的编码器注册副作用，
 * 本文件随后挂载 self.onmessage，开始处理消息。
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
