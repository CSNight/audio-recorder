import type { MaybePromise, PcmBufferSnapshot } from "../buffer/types"

export type RecorderStorageMode = "memory" | "persistent" | "auto"

export interface RecorderStorageOptions {
  // mode 决定缓冲策略：memory 始终内存，persistent 直接持久化，auto 在超过阈值后切换。
  mode?: RecorderStorageMode
  // auto 模式下触发持久化切换的内存阈值。
  memoryThresholdBytes?: number
  // 单次持久化写入目标块大小，用于平衡 I/O 频率和写入粒度。
  persistenceChunkBytes?: number
  // 具体持久化实现由可选插件提供，核心库只保留接口与生命周期。
  persistencePlugin?: RecorderPersistencePlugin
}

export interface RecorderPersistencePlugin {
  // 先在运行时确认后端是否可用，再决定是否进入持久化路径。
  readonly backend: "opfs" | "indexeddb"
  isSupported(): MaybePromise<boolean>
  createSession(
    options: RecorderPersistenceSessionOptions
  ): Promise<RecorderPersistenceSession>
}

export interface RecorderPersistenceSessionOptions {
  // sessionId 和 startedAt 共同标识当前录音轮次，避免历史残留串入下一次会话。
  sessionId: string
  startedAt: number
}

export interface RecorderPersistenceSession {
  appendSnapshot(snapshot: PcmBufferSnapshot): Promise<void>
  readSnapshots(): Promise<readonly PcmBufferSnapshot[]>
  clear(): Promise<void>
  close(): Promise<void>
}
