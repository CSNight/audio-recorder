import type {
  EncoderWorkerOutgoingMessage,
  StreamEncoder,
  StreamEncoderDefinition,
} from "../../types"

export interface SonicStreamEncoderBridgeOptions {
  format: string
  encoderOptions?: unknown
  definition: StreamEncoderDefinition
  /**
   * Sonic 导出入口保留独立 bridge，避免与 streaming-export 共享公共 chunk。
   * 行为保持与通用 bridge 一致：有 Worker 就走 Worker，没有就退回主线程。
   */
  allowMainThreadFallback?: boolean | undefined
}

type PendingResolve = (value: Uint8Array | null) => void
type PendingReject = (reason: Error) => void

export class SonicStreamEncoderBridge {
  private worker: Worker | null = null
  private encoder: StreamEncoder | null = null
  private disposed = false
  private workerError: Error | null = null

  private readonly definition: StreamEncoderDefinition
  private readonly pending = new Map<
    number,
    { resolve: PendingResolve; reject: PendingReject }
  >()
  private nextSeqId = 0

  private readyPromise: Promise<void> = Promise.resolve()
  private resolveReady: (() => void) | null = null
  private rejectReady: ((reason: Error) => void) | null = null

  constructor(options: SonicStreamEncoderBridgeOptions) {
    this.definition = options.definition
    const allowFallback = options.allowMainThreadFallback ?? true

    if (typeof Worker !== "undefined" && options.definition.workerFactory) {
      try {
        this.worker = options.definition.workerFactory()
        this.setupWorkerHandlers()
        this.createReadyPromise()
        this.worker.postMessage({
          type: "init",
          format: options.format,
          options: options.encoderOptions,
        })
      } catch {
        this.worker = null
      }
    }

    if (this.worker === null) {
      if (!allowFallback) {
        throw new Error(
          "SonicStreamEncoderBridge: Worker is not available and allowMainThreadFallback is false."
        )
      }
      this.encoder = options.definition.create(options.encoderOptions)
    }
  }

  reset(encoderOptions?: unknown): void {
    if (this.worker !== null) {
      this.workerError = null
      this.createReadyPromise()
      this.worker.postMessage({ type: "reset", options: encoderOptions })
      return
    }

    if (this.encoder !== null) {
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
        new Error("SonicStreamEncoderBridge has been disposed.")
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
        this.worker!.postMessage({
          type: "feedFrame",
          planar,
          channels,
          sampleRate,
          seqId,
        })
      })
    }

    try {
      return Promise.resolve(
        this.encoder!.feedFrame(channels, sampleRate, planar)
      )
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }

  async flush(): Promise<Uint8Array | null> {
    if (this.disposed) {
      return Promise.reject(
        new Error("SonicStreamEncoderBridge has been disposed.")
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
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error))
      )
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
      const error = new Error("SonicStreamEncoderBridge disposed")
      this.rejectWorkerReady(error)
      for (const entry of this.pending.values()) {
        entry.reject(error)
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
    this.readyPromise.catch(() => {})
  }

  private resolveWorkerReady(): void {
    this.workerError = null
    this.resolveReady?.()
    this.resolveReady = null
    this.rejectReady = null
  }

  private rejectWorkerReady(error: Error): void {
    this.workerError = error
    this.rejectReady?.(error)
    this.resolveReady = null
    this.rejectReady = null
  }

  private setupWorkerHandlers(): void {
    this.worker!.onmessage = (
      event: MessageEvent<EncoderWorkerOutgoingMessage>
    ) => {
      const message = event.data

      if (message.type === "ready") {
        this.resolveWorkerReady()
        return
      }

      if (message.type === "error" && message.seqId < 0) {
        this.rejectWorkerReady(new Error(message.message))
        return
      }

      const entry = this.pending.get(message.seqId)
      if (entry === undefined) {
        return
      }
      this.pending.delete(message.seqId)

      if (message.type === "result") {
        entry.resolve(message.result)
        return
      }

      entry.reject(new Error(message.message))
    }

    this.worker!.onerror = (event) => {
      const error = new Error(event.message ?? "Worker error")
      this.rejectWorkerReady(error)
      for (const entry of this.pending.values()) {
        entry.reject(error)
      }
      this.pending.clear()
    }
  }
}
