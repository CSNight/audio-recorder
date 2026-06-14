import { ComplexPcmBufferStore } from "@/buffer/complex-pcm-buffer-store"
import { InMemoryPcmBufferStore } from "@/buffer/in-memory-pcm-buffer-store"
import { PersistPcmBufferStore } from "@/buffer/persist-pcm-buffer-store"
import type { PcmBufferStore } from "@/buffer/types"
import type { RecorderStorageOptions } from "@/storage/types"
import type { RecorderIssue } from "@/types"

export interface PcmBufferStoreOptions {
  sessionId: string
  startedAt: number
  storage: RecorderStorageOptions | undefined
  emitIssue: ((issue: RecorderIssue) => void) | undefined
}

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
