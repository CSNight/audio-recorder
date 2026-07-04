/**
 * ChunkedEncoderBridge：
 * - Worker 可用时：在 Worker 线程中运行 ChunkedEncoder，通过 postMessage 传递帧数据
 * - Worker 不可用时：主线程同步回退，接口对外透明
 *
 * feedFrame / flush 均返回 Promise，由 plugin.ts 以 fire-and-forget 方式调用。
 *
 * Worker 来源：
 * - definition.workerFactory()  — 编解码器自带专属 Worker（当前主要用于 pcm-worker.ts、wav-worker.ts）
 * - 若 definition 无 workerFactory，则降级到主线程同步执行
 *
 * 使用 `?worker&inline` 将各 codec Worker 内联为 base64 blob，避免额外的网络请求。
 */

import type {
  EncoderWorkerOutgoingMessage,
  StreamEncoder,
  StreamEncoderDefinition,
} from "../types"

export interface StreamEncoderBridgeOptions {
  format: string
  encoderOptions?: unknown
  definition: StreamEncoderDefinition
  /**
   * Worker 编码不可用时是否允许降级到主线程同步编码。
   * 默认 true。设为 false 时若 Worker 不可用则抛出错误。
   */
  allowMainThreadFallback?: boolean | undefined
}

type PendingResolve = (value: Uint8Array | null) => void
type PendingReject = (reason: Error) => void

export class ChunkedEncoderBridge {
  private worker: Worker | null = null
  private encoder: StreamEncoder | null = null
  private disposed = false
  private workerError: Error | null = null

  // 保存 definition，供 reset() 主线程模式调用 definition.create()
  private readonly definition: StreamEncoderDefinition

  // Worker 模式下挂起的 Promise 回调，按 seqId 查找
  private readonly pending = new Map<
    number,
    { resolve: PendingResolve; reject: PendingReject }
  >()
  private nextSeqId = 0

  // Worker 就绪信号；init/reset 完成前 feedFrame/flush 自动等待
  private readyPromise: Promise<void> = Promise.resolve()
  private resolveReady: (() => void) | null = null
  private rejectReady: ((reason: Error) => void) | null = null

  constructor(opts: StreamEncoderBridgeOptions) {
    this.definition = opts.definition
    const allowFallback = opts.allowMainThreadFallback ?? true

    if (typeof Worker !== "undefined" && opts.definition.workerFactory) {
      try {
        this.worker = opts.definition.workerFactory()
        this.setupWorkerHandlers()
        this.createReadyPromise()

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
      // 主线程模式：definition.create() 此时可同步调用（preload 已在 setup 中完成）
      this.encoder = opts.definition.create(opts.encoderOptions)
    }
  }

  /** 每次录音开始前调用，重置 encoder 状态 */
  reset(encoderOptions?: unknown): void {
    if (this.worker !== null) {
      this.workerError = null
      this.createReadyPromise()
      this.worker.postMessage({ type: "reset", options: encoderOptions })
    } else if (this.encoder !== null) {
      this.encoder.dispose()
      this.encoder = this.definition.create(encoderOptions)
    }
  }

  async feedFrame(
    channels: number,
    sampleRate: number,
    planar: Int16Array[]
  ): Promise<Uint8Array | null> {
    if (this.disposed) {
      return Promise.reject(
        new Error("ChunkedEncoderBridge has been disposed.")
      )
    }

    if (this.worker !== null) {
      if (this.workerError) {
        return Promise.reject(this.workerError)
      }

      // 先等 ready（init 或 reset 完成），正常路径下已 resolve，await 几乎零开销
      await this.readyPromise
      if (this.workerError) {
        return Promise.reject(this.workerError)
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

    // 主线程同步模式
    try {
      return Promise.resolve(
        this.encoder!.feedFrame(channels, sampleRate, planar)
      )
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
  }

  async flush(): Promise<Uint8Array | null> {
    if (this.disposed) {
      return Promise.reject(
        new Error("ChunkedEncoderBridge has been disposed.")
      )
    }

    if (this.worker !== null) {
      if (this.workerError) {
        return Promise.reject(this.workerError)
      }

      await this.readyPromise
      if (this.workerError) {
        return Promise.reject(this.workerError)
      }

      const seqId = this.nextSeqId++
      return new Promise<Uint8Array | null>((resolve, reject) => {
        this.pending.set(seqId, { resolve, reject })
        this.worker!.postMessage({ type: "flush", seqId })
      })
    }

    try {
      return Promise.resolve(this.encoder!.flush())
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)))
    }
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
      this.rejectWorkerReady(err)
      for (const entry of this.pending.values()) {
        entry.reject(err)
      }
      this.pending.clear()
      this.worker.terminate()
      this.worker = null
    }
  }

  private createReadyPromise(): void {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // readyPromise may reject before callers await it. Attach a noop catch to
    // keep the rejection observable through later awaits without reporting it
    // as an unhandled rejection.
    this.readyPromise.catch(() => {})
  }

  private resolveWorkerReady(): void {
    this.workerError = null
    this.resolveReady?.()
    this.resolveReady = null
    this.rejectReady = null
  }

  private rejectWorkerReady(err: Error): void {
    this.workerError = err
    this.rejectReady?.(err)
    this.resolveReady = null
    this.rejectReady = null
  }

  private setupWorkerHandlers(): void {
    this.worker!.onmessage = (
      event: MessageEvent<EncoderWorkerOutgoingMessage>
    ) => {
      const msg = event.data

      if (msg.type === "ready") {
        this.resolveWorkerReady()
        return
      }

      if (msg.type === "error" && msg.seqId < 0) {
        this.rejectWorkerReady(new Error(msg.message))
        return
      }

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

    this.worker!.onerror = (event) => {
      const err = new Error(event.message ?? "Worker error")
      this.rejectWorkerReady(err)
      for (const entry of this.pending.values()) {
        entry.reject(err)
      }
      this.pending.clear()
    }
  }
}
