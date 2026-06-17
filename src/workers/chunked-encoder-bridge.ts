/**
 * ChunkedEncoderBridge：
 * - Worker 可用时：在 Worker 线程中运行 ChunkedEncoder，通过 postMessage 传递帧数据
 * - Worker 不可用时：主线程同步回退，接口对外透明
 *
 * feedFrame / flush 均返回 Promise，由 plugin.ts 以 fire-and-forget 方式调用。
 *
 * Worker 来源优先级：
 * 1. definition.workerFactory()  — 编解码器自带专属 Worker（如 mp3-worker.ts）
 * 2. defaultWorkerFactory()      — 默认 PCM/WAV Worker（chunked-encoder-worker.ts，inline blob）
 *
 * 使用 `?worker&inline` 将默认 Worker 内联为 base64 blob，避免额外的网络请求，
 * 同时在 CSP 严格环境下仍可正常实例化（blob: URL 通常被允许）。
 */

import type { ChunkedEncoder } from "@/plugins/streaming-export/types"
import type { ChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"
import InlineDefaultWorker from "./chunked-encoder-worker.ts?worker&inline"

/** 默认 Worker 工厂（PCM/WAV 通用，不含 MP3/lamejs） */
const defaultWorkerFactory = (): Worker => new InlineDefaultWorker()

export interface ChunkedEncoderBridgeOptions {
  format: string
  encoderOptions?: unknown
  registry: ChunkedEncoderRegistry
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

    if (typeof Worker !== "undefined") {
      try {
        // 优先使用编解码器自带的专属 Worker（如 mp3-worker.ts），
        // 回退到默认的 PCM/WAV inline Worker
        const definition = opts.registry.get(opts.format)
        const workerFactory = definition.workerFactory ?? defaultWorkerFactory
        this.worker = workerFactory()

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
      this.encoder = opts.registry.get(opts.format).create(opts.encoderOptions)
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

    // Worker 模式：postMessage（结构化克隆，不 transfer）+ 挂起 Promise
    // 不使用 Transferable 是因为主线程后续可能还需要访问 planar 数据，
    // 且单帧数据量（128-4096 samples）克隆开销远小于零拷贝引发的正确性问题：
    // 多声道共享同一 ArrayBuffer 时 transfer 会导致第二个声道 detached。
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
