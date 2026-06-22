/**
 * ChunkedEncoderBridge：
 * - Worker 可用时：在 Worker 线程中运行 ChunkedEncoder，通过 postMessage 传递帧数据
 * - Worker 不可用时：主线程同步回退，接口对外透明
 *
 * feedFrame / flush 均返回 Promise，由 plugin.ts 以 fire-and-forget 方式调用。
 *
 * Worker 来源：
 * - definition.workerFactory()  — 编解码器自带专属 Worker（如 mp3-worker.ts、pcm-worker.ts、wav-worker.ts）
 * - 若 definition 无 workerFactory，则降级到主线程同步执行
 *
 * 使用 `?worker&inline` 将各 codec Worker 内联为 base64 blob，避免额外的网络请求。
 */

import type { ChunkedEncoder, ChunkedEncoderDefinition } from "@/plugins/streaming-export/types"

export interface ChunkedEncoderBridgeOptions {
  format: string
  encoderOptions?: unknown
  definition: ChunkedEncoderDefinition
  /**
   * Worker 编码不可用时是否允许降级到主线程同步编码。
   * 默认 true。设为 false 时若 Worker 不可用则抛出错误。
   */
  allowMainThreadFallback?: boolean | undefined
}

type WorkerOutgoingMessage =
  | { type: "result"; result: Uint8Array | null; seqId: number }
  | { type: "error"; message: string; seqId: number }

type PendingResolve = (value: Uint8Array | null) => void
type PendingReject = (reason: Error) => void

export class ChunkedEncoderBridge {
  private worker: Worker | null = null
  private encoder: ChunkedEncoder | null = null
  private disposed = false

  // Worker 模式下挂起的 Promise 回调，按 seqId 查找
  private readonly pending = new Map<
    number,
    { resolve: PendingResolve; reject: PendingReject }
  >()
  private nextSeqId = 0

  constructor(opts: ChunkedEncoderBridgeOptions) {
    const allowFallback = opts.allowMainThreadFallback ?? true

    if (typeof Worker !== "undefined" && opts.definition.workerFactory) {
      try {
        this.worker = opts.definition.workerFactory()

        this.worker.onmessage = (
          event: MessageEvent<WorkerOutgoingMessage>
        ) => {
          const msg = event.data
          const entry = this.pending.get(msg.seqId)
          if (entry === undefined) {
            return
          }
          this.pending.delete(msg.seqId)

          if (msg.type === "result") {
            entry.resolve(msg.result)
          } else {
            entry.reject(new Error(msg.message))
          }
        }

        this.worker.onerror = (event) => {
          const err = new Error(event.message ?? "Worker error")
          for (const entry of this.pending.values()) {
            entry.reject(err)
          }
          this.pending.clear()
        }

        // 初始化 Worker 侧的 encoder
        this.worker.postMessage({
          type: "init",
          format: opts.format,
          options: opts.encoderOptions,
        })
      } catch {
        // Worker 构造失败（如某些沙箱环境），尝试回退
        this.worker = null
      }
    }

    // Worker 不可用时走主线程 encoder
    if (this.worker === null) {
      if (!allowFallback) {
        throw new Error(
          `ChunkedEncoderBridge: Worker is not available and allowMainThreadFallback is false.`
        )
      }
      this.encoder = opts.definition.create(opts.encoderOptions)
    }
  }

  feedFrame(
    channels: number,
    sampleRate: number,
    planar: Int16Array[]
  ): Promise<Uint8Array | null> {
    if (this.disposed) {
      return Promise.reject(
        new Error("ChunkedEncoderBridge has been disposed.")
      )
    }

    // 主线程同步模式
    if (this.encoder !== null) {
      try {
        return Promise.resolve(
          this.encoder.feedFrame(channels, sampleRate, planar)
        )
      } catch (err) {
        return Promise.reject(
          err instanceof Error ? err : new Error(String(err))
        )
      }
    }

    const seqId = this.nextSeqId++
    return new Promise<Uint8Array | null>((resolve, reject) => {
      this.pending.set(seqId, { resolve, reject })
      this.worker!.postMessage({
        type: "feedFrame",
        planar,
        channels,
        sampleRate,
        seqId,
      })
    })
  }

  flush(): Promise<Uint8Array | null> {
    if (this.disposed) {
      return Promise.reject(
        new Error("ChunkedEncoderBridge has been disposed.")
      )
    }

    if (this.encoder !== null) {
      try {
        return Promise.resolve(this.encoder.flush())
      } catch (err) {
        return Promise.reject(
          err instanceof Error ? err : new Error(String(err))
        )
      }
    }

    const seqId = this.nextSeqId++
    return new Promise<Uint8Array | null>((resolve, reject) => {
      this.pending.set(seqId, { resolve, reject })
      this.worker!.postMessage({ type: "flush", seqId })
    })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true

    if (this.encoder !== null) {
      this.encoder.dispose()
      this.encoder = null
    }

    if (this.worker !== null) {
      this.worker.postMessage({ type: "dispose" })
      const err = new Error("ChunkedEncoderBridge disposed")
      for (const entry of this.pending.values()) {
        entry.reject(err)
      }
      this.pending.clear()
      this.worker.terminate()
      this.worker = null
    }
  }
}
