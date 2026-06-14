import { InMemoryPcmBufferStore } from "@/buffer/in-memory-pcm-buffer-store"
import { getFrameBytes, mergeChannelChunks } from "@/buffer/pcm-buffer-utils"
import type { PcmBufferSnapshot, PcmBufferStore } from "@/buffer/types"
import type {
  RecorderPersistencePlugin,
  RecorderPersistenceSession,
  RecorderStorageOptions,
} from "@/storage/types"
import type { AudioFrame, RecorderIssue } from "@/types"
import { RecorderWarningCode } from "@/types"

export interface PersistPcmBufferStoreOptions {
  sessionId: string
  startedAt: number
  storage: RecorderStorageOptions | undefined
  emitIssue: ((issue: RecorderIssue) => void) | undefined
}

export class PersistPcmBufferStore implements PcmBufferStore {
  private readonly persistenceChunkBytes: number
  private readonly persistencePlugin: RecorderPersistencePlugin | undefined
  private readonly pendingChunkStore = new InMemoryPcmBufferStore()
  private readonly sessionId: string
  private readonly startedAt: number
  private readonly emitIssue: ((issue: RecorderIssue) => void) | undefined
  private activeSession: RecorderPersistenceSession | undefined
  private pendingChunkBytes = 0
  private pendingWrite = Promise.resolve()
  private lastWriteError: Error | undefined

  constructor(options: PersistPcmBufferStoreOptions) {
    this.sessionId = options.sessionId
    this.startedAt = options.startedAt
    this.persistenceChunkBytes =
      options.storage?.persistenceChunkBytes ?? 256 * 1024
    this.persistencePlugin = options.storage?.persistencePlugin
    this.emitIssue = options.emitIssue
  }

  async initialize(): Promise<void> {
    if (this.activeSession) {
      return
    }

    const plugin = await this.requirePersistencePlugin()
    if (!plugin) {
      throw new Error(
        "Persistent storage mode requires an available persistence plugin before recording starts."
      )
    }

    try {
      this.activeSession = await plugin.createSession({
        sessionId: this.sessionId,
        startedAt: this.startedAt,
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to activate persistence storage before recording starts."

      this.emitIssue?.({
        kind: "warning",
        warning: {
          code: RecorderWarningCode.PersistenceActivationFailed,
          message,
        },
      })

      throw new Error(message, {
        cause: error,
      })
    }
  }

  appendFrame(frame: AudioFrame): void {
    this.requireActiveSession()
    this.pendingChunkStore.appendFrame(frame)
    this.pendingChunkBytes += getFrameBytes(frame)

    if (this.pendingChunkBytes >= this.persistenceChunkBytes) {
      this.flushPendingChunk()
    }
  }

  appendSnapshot(snapshot: PcmBufferSnapshot): void {
    this.requireActiveSession()
    this.queueSnapshotWrite(snapshot)
  }

  async snapshot(): Promise<PcmBufferSnapshot | undefined> {
    const session = this.activeSession
    if (!session) {
      return undefined
    }

    this.flushPendingChunk()
    await this.pendingWrite

    if (this.lastWriteError) {
      throw this.lastWriteError
    }

    return mergeSnapshots(await session.readSnapshots())
  }

  async clear(): Promise<void> {
    this.flushPendingChunk()
    await this.pendingWrite.catch(() => undefined)
    this.pendingChunkStore.clear()
    this.pendingChunkBytes = 0

    if (!this.activeSession) {
      this.lastWriteError = undefined
      this.pendingWrite = Promise.resolve()
      return
    }

    try {
      await this.activeSession.clear()
      await this.activeSession.close()
    } finally {
      this.activeSession = undefined
      this.pendingWrite = Promise.resolve()
      this.lastWriteError = undefined
    }
  }

  private requireActiveSession(): RecorderPersistenceSession {
    if (!this.activeSession) {
      throw new Error(
        "PersistPcmBufferStore must be initialized before accepting PCM data."
      )
    }

    return this.activeSession
  }

  private async requirePersistencePlugin(): Promise<
    RecorderPersistencePlugin | undefined
  > {
    if (!this.persistencePlugin) {
      this.emitIssue?.({
        kind: "warning",
        warning: {
          code: RecorderWarningCode.PersistencePluginMissing,
          message:
            "Persistent storage mode was requested, but no persistence plugin was provided.",
        },
      })
      return undefined
    }

    if (await this.persistencePlugin.isSupported()) {
      return this.persistencePlugin
    }

    this.emitIssue?.({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.PersistencePluginUnavailable,
        message:
          "The configured persistence plugin is not supported in this browser.",
      },
    })

    return undefined
  }

  private flushPendingChunk(): void {
    const snapshot = this.pendingChunkStore.drainSnapshot()
    if (!snapshot) {
      return
    }

    this.pendingChunkBytes = 0
    this.queueSnapshotWrite(snapshot)
  }

  private queueSnapshotWrite(snapshot: PcmBufferSnapshot): void {
    const session = this.requireActiveSession()
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        await session.appendSnapshot(snapshot)
      })
      .catch((error) => {
        this.lastWriteError =
          error instanceof Error
            ? error
            : new Error("Failed to persist PCM snapshot.")
        throw this.lastWriteError
      })
  }
}

export function mergeSnapshots(
  snapshots: readonly PcmBufferSnapshot[]
): PcmBufferSnapshot | undefined {
  const first = snapshots[0]
  if (!first) {
    return undefined
  }

  const mergedChannels = Array.from(
    { length: first.channels },
    () => [] as Int16Array[]
  )
  let frameCount = 0
  let durationMs = 0

  for (const snapshot of snapshots) {
    if (
      snapshot.sampleRate !== first.sampleRate ||
      snapshot.channels !== first.channels
    ) {
      throw new Error("Persisted PCM snapshots must share the same layout.")
    }

    frameCount += snapshot.frameCount
    durationMs += snapshot.durationMs

    for (
      let channelIndex = 0;
      channelIndex < snapshot.channels;
      channelIndex += 1
    ) {
      const channel = snapshot.planar[channelIndex]
      if (!channel) {
        throw new Error(
          `Persisted PCM snapshot is missing channel ${channelIndex}.`
        )
      }

      mergedChannels[channelIndex]?.push(channel)
    }
  }

  return {
    sampleRate: first.sampleRate,
    channels: first.channels,
    frameCount,
    durationMs,
    planar: mergedChannels.map((chunks) => mergeChannelChunks(chunks)),
  }
}
