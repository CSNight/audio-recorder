import { InMemoryPcmBufferStore } from "@/buffer/in-memory-pcm-buffer-store"
import { getFrameBytes } from "@/buffer/pcm-buffer-utils"
import { PersistPcmBufferStore } from "@/buffer/persist-pcm-buffer-store"
import type { PcmBufferSnapshot, PcmBufferStore } from "@/buffer/types"
import type { RecorderStorageOptions } from "@/storage/types"
import type { AudioFrame, RecorderIssue } from "@/types"

/** `ComplexPcmBufferStore` 的构造参数 */
export interface ComplexPcmBufferStoreOptions {
  /** 录音会话 ID */
  sessionId: string
  /** 录音开始时间戳（ms） */
  startedAt: number
  /** 持久化存储配置；undefined 表示纯内存模式 */
  storage: RecorderStorageOptions | undefined
  /** 发出非致命问题的回调 */
  emitIssue: ((issue: RecorderIssue) => void) | undefined
}

/** 当前缓冲阶段：纯内存 / 迁移中 / 持久化 */
type ComplexStage = "memory" | "promoting" | "persist"

/**
 * 混合 PCM 缓冲区，支持内存 → 持久化自动晋升。
 *
 * - 录音初期所有帧写入内存缓冲（`InMemoryPcmBufferStore`）。
 * - 当内存占用超过 `storage.memoryThresholdBytes` 后，异步发起 **promotion**：
 *   将历史快照迁移至持久化存储（`PersistPcmBufferStore`），
 *   迁移期间新帧暂存于过渡缓冲（`promotionStore`），迁移完成后合并写入。
 * - 若持久化初始化失败则回退到内存模式，数据不丢失。
 */
export class ComplexPcmBufferStore implements PcmBufferStore {
  private readonly memoryThresholdBytes: number
  private readonly memoryStore = new InMemoryPcmBufferStore()
  // promotion 期间的新帧先落到过渡缓冲，避免和历史快照迁移互相竞争。
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
        // 超阈值后异步发起 promotion；当前帧仍算作内存阶段的一部分。
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
