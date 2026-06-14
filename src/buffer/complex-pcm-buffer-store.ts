import { InMemoryPcmBufferStore } from "@/buffer/in-memory-pcm-buffer-store"
import { getFrameBytes } from "@/buffer/pcm-buffer-utils"
import { PersistPcmBufferStore } from "@/buffer/persist-pcm-buffer-store"
import type { PcmBufferSnapshot, PcmBufferStore } from "@/buffer/types"
import type { RecorderStorageOptions } from "@/storage/types"
import type { AudioFrame, RecorderIssue } from "@/types"

export interface ComplexPcmBufferStoreOptions {
  sessionId: string
  startedAt: number
  storage: RecorderStorageOptions | undefined
  emitIssue: ((issue: RecorderIssue) => void) | undefined
}

type ComplexStage = "memory" | "promoting" | "persist"

export class ComplexPcmBufferStore implements PcmBufferStore {
  private readonly memoryThresholdBytes: number
  private readonly memoryStore = new InMemoryPcmBufferStore()
  private readonly promotionStore = new InMemoryPcmBufferStore()
  private readonly persistStore: PersistPcmBufferStore
  private stage: ComplexStage = "memory"
  private memoryBytes = 0
  private promotionPromise: Promise<void> | undefined

  constructor(options: ComplexPcmBufferStoreOptions) {
    this.memoryThresholdBytes = options.storage?.memoryThresholdBytes ?? 0
    this.persistStore = new PersistPcmBufferStore(options)
  }

  async initialize(): Promise<void> {
    return
  }

  appendFrame(frame: AudioFrame): void {
    if (this.stage === "memory") {
      this.memoryStore.appendFrame(frame)
      this.memoryBytes += getFrameBytes(frame)

      if (
        this.memoryThresholdBytes > 0 &&
        this.memoryBytes > this.memoryThresholdBytes
      ) {
        this.startPromotion()
      }
      return
    }

    if (this.stage === "promoting") {
      this.promotionStore.appendFrame(frame)
      return
    }

    this.persistStore.appendFrame(frame)
  }

  async snapshot(): Promise<PcmBufferSnapshot | undefined> {
    await this.awaitPromotion()

    if (this.stage === "persist") {
      return this.persistStore.snapshot()
    }

    return this.memoryStore.snapshot()
  }

  async clear(): Promise<void> {
    await this.awaitPromotion()
    this.memoryStore.clear()
    this.promotionStore.clear()
    this.memoryBytes = 0
    this.stage = "memory"
    await this.persistStore.clear()
  }

  private startPromotion(): void {
    const initialSnapshot = this.memoryStore.drainSnapshot()
    this.memoryBytes = 0
    this.stage = "promoting"
    this.promotionPromise = this.promoteToPersist(initialSnapshot).finally(
      () => {
        this.promotionPromise = undefined
      }
    )
  }

  private async promoteToPersist(
    initialSnapshot: PcmBufferSnapshot | undefined
  ): Promise<void> {
    try {
      await this.persistStore.initialize()

      if (initialSnapshot) {
        this.persistStore.appendSnapshot(initialSnapshot)
      }

      const bufferedDuringPromotion = this.promotionStore.drainSnapshot()
      if (bufferedDuringPromotion) {
        this.persistStore.appendSnapshot(bufferedDuringPromotion)
      }

      this.stage = "persist"
      return
    } catch {
      if (initialSnapshot) {
        this.memoryStore.appendSnapshot(initialSnapshot)
      }

      const bufferedDuringPromotion = this.promotionStore.drainSnapshot()
      if (bufferedDuringPromotion) {
        this.memoryStore.appendSnapshot(bufferedDuringPromotion)
      }

      this.stage = "memory"
    }
  }

  private async awaitPromotion(): Promise<void> {
    if (this.promotionPromise) {
      await this.promotionPromise
    }
  }
}
