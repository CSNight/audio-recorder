import { ComplexPcmBufferStore } from "./complex-pcm-buffer-store"
import { InMemoryPcmBufferStore } from "./in-memory-pcm-buffer-store"
import { PersistPcmBufferStore } from "./persist-pcm-buffer-store"
import type { PcmBufferStore } from "./types"
import type { RecorderStorageOptions } from "../storage"
import type { RecorderIssue } from "../types"

export interface PcmBufferStoreOptions {
  sessionId: string
  startedAt: number
  storage: RecorderStorageOptions | undefined
  emitIssue: ((issue: RecorderIssue) => void) | undefined
}

/**
 * 按 storage.mode 选择 PcmBufferStore 实现：
 * - "memory"（默认）→ 纯内存，不落盘
 * - "persistent" → 仅持久化（IndexedDB/OPFS），不保留内存副本
 * - 其余（"complex" 等）→ 内存 + 持久化双写，兼顾快速读取与崩溃恢复
 */
export function createPcmBufferStore(
  options: PcmBufferStoreOptions
): PcmBufferStore {
  const storageMode = options.storage?.mode ?? "memory"

  if (storageMode === "memory") {
    return new InMemoryPcmBufferStore()
  }

  if (storageMode === "persistent") {
    return new PersistPcmBufferStore(options)
  }

  return new ComplexPcmBufferStore(options)
}
