/**
 * ChunkedEncoder Worker 消息循环核心。
 *
 * 导出 createWorkerMessageHandler(resolveDefinition) 工厂函数，
 * 各 Worker 入口文件调用此函数并将结果赋值给 self.onmessage，
 * 静态绑定自己的 ChunkedEncoderDefinition，无需任何注册表。
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
import type { ChunkedEncoder, ChunkedEncoderDefinition } from "@/plugins/streaming-export/types"

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

function postMsg(msg: WorkerOutgoingMessage, transfer?: Transferable[]) {
  if (transfer) {
    ;(self as unknown as Worker).postMessage(msg, transfer)
  } else {
    ;(self as unknown as Worker).postMessage(msg)
  }
}

/**
 * 创建 Worker 消息处理函数。
 *
 * @param resolveDefinition 根据 format 返回 ChunkedEncoderDefinition 的函数。
 *   各 Worker 入口文件静态绑定自己的 definition，直接忽略 format 参数并返回：
 *   `() => myChunkedEncoderDefinition`
 */
export function createWorkerMessageHandler(
  resolveDefinition: (format: string) => ChunkedEncoderDefinition
): (event: MessageEvent<WorkerIncomingMessage>) => void {
  let encoder: ChunkedEncoder | null = null

  return (event: MessageEvent<WorkerIncomingMessage>) => {
    const msg = event.data

    if (msg.type === "init") {
      try {
        const definition = resolveDefinition(msg.format)
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
}
