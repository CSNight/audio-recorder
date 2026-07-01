/**
 * ChunkedEncoder Worker 消息循环核心。
 *
 * 导出 createWorkerMessageHandler(resolveDefinition) 工厂函数，
 * 各 Worker 入口文件调用此函数并将结果赋值给 self.onmessage，
 * 静态绑定自己的 StreamEncoderDefinition，无需任何注册表。
 *
 * 消息协议：
 *   { type: "init",      format: string,    options?: unknown }
 *   { type: "reset",     options?: unknown }
 *   { type: "feedFrame", planar: Int16Array[], channels: number, sampleRate: number, seqId: number }
 *   { type: "flush",     seqId: number }
 *   { type: "dispose" }
 *
 * 响应协议：
 *   { type: "ready" }
 *   { type: "result",    result: Uint8Array | null, seqId: number }
 *   { type: "error",     message: string,            seqId: number }
 */
import type {
  StreamEncoder,
  StreamEncoderDefinition,
} from "@/plugins/streaming-export/types"
import type {
  EncoderWorkerIncomingMessage,
  EncoderWorkerOutgoingMessage,
} from "@/types"

function postMsg(msg: EncoderWorkerOutgoingMessage, transfer?: Transferable[]) {
  if (transfer) {
    ;(self as unknown as Worker).postMessage(msg, transfer)
  } else {
    ;(self as unknown as Worker).postMessage(msg)
  }
}

/**
 * 创建 Worker 消息处理函数。
 *
 * @param resolveDefinition 根据 format 返回 StreamEncoderDefinition 的函数。
 *   各 Worker 入口文件静态绑定自己的 definition，直接忽略 format 参数并返回：
 *   `() => myStreamEncoder`
 */
export function createWorkerMessageHandler(
  resolveDefinition: (format: string) => StreamEncoderDefinition
): (event: MessageEvent<EncoderWorkerIncomingMessage>) => void {
  let definition: StreamEncoderDefinition | null = null
  let encoder: StreamEncoder | null = null

  return async (event: MessageEvent<EncoderWorkerIncomingMessage>) => {
    const msg = event.data

    if (msg.type === "init") {
      try {
        definition = resolveDefinition(msg.format)
        // Worker 顶层已触发 preload，此处是安全保障（幂等，几乎零开销）
        await definition.preload?.()
        encoder = definition.create(msg.options)
        postMsg({ type: "ready" })
      } catch (err) {
        postMsg({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
          seqId: -1,
        })
      }
      return
    }

    if (msg.type === "reset") {
      // 释放当前 encoder（仅释放 WASM 堆内存，不影响模块本身）
      encoder?.dispose()
      encoder = null
      try {
        // WASM 模块已在内存（init 阶段已 await preload），同步创建，几乎零延迟
        encoder = definition!.create(msg.options)
        postMsg({ type: "ready" })
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
        const result = encoder.feedFrame(
          msg.channels,
          msg.sampleRate,
          msg.planar
        )
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
