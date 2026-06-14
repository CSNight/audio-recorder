import type { MaybePromise, PcmBufferSnapshot } from "@/buffer/types"

export type RecorderStorageMode = "memory" | "persistent" | "auto"

export interface RecorderStorageOptions {
  mode?: RecorderStorageMode
  memoryThresholdBytes?: number
  persistenceChunkBytes?: number
  persistencePlugin?: RecorderPersistencePlugin
}

export interface RecorderPersistencePlugin {
  readonly backend: "opfs" | "indexeddb"
  isSupported(): MaybePromise<boolean>
  createSession(
    options: RecorderPersistenceSessionOptions
  ): Promise<RecorderPersistenceSession>
}

export interface RecorderPersistenceSessionOptions {
  sessionId: string
  startedAt: number
}

export interface RecorderPersistenceSession {
  appendSnapshot(snapshot: PcmBufferSnapshot): Promise<void>
  readSnapshots(): Promise<readonly PcmBufferSnapshot[]>
  clear(): Promise<void>
  close(): Promise<void>
}
