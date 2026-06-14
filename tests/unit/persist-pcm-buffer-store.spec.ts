import { describe, expect, it, vi } from "vitest"
import { PersistPcmBufferStore } from "@/buffer/persist-pcm-buffer-store"
import type {
  RecorderPersistencePlugin,
  RecorderPersistenceSession,
} from "@/storage/types"
import { RecorderWarningCode } from "@/types"
import { createAudioFrame } from "@/utils/audio-frame"

function createPluginStub(): {
  plugin: RecorderPersistencePlugin
  session: RecorderPersistenceSession
  appendSnapshot: ReturnType<typeof vi.fn>
  readSnapshots: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
} {
  let latestSnapshots: Awaited<
    ReturnType<RecorderPersistenceSession["readSnapshots"]>
  > = []
  const appendSnapshot = vi.fn(async (snapshot) => {
    latestSnapshots = [...latestSnapshots, snapshot]
  })
  const readSnapshots = vi.fn(async () => latestSnapshots)
  const clear = vi.fn(async () => {
    latestSnapshots = []
  })
  const close = vi.fn(async () => {})
  const session: RecorderPersistenceSession = {
    appendSnapshot,
    readSnapshots,
    clear,
    close,
  }

  return {
    plugin: {
      backend: "indexeddb",
      isSupported: () => true,
      createSession: async () => session,
    },
    session,
    appendSnapshot,
    readSnapshots,
    clear,
    close,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}

describe("PersistPcmBufferStore", () => {
  it("activates persistence immediately in persistent mode", async () => {
    const persistence = createPluginStub()
    const store = new PersistPcmBufferStore({
      sessionId: "session-persist-1",
      startedAt: 21,
      storage: {
        mode: "persistent",
        persistencePlugin: persistence.plugin,
      },
      emitIssue: undefined,
    })
    await store.initialize()

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )

    const snapshot = await store.snapshot()

    expect(persistence.appendSnapshot).toHaveBeenCalledTimes(1)
    expect(snapshot?.frameCount).toBe(1)
  })

  it("merges multiple persisted snapshots instead of keeping only the last chunk", async () => {
    const persistence = createPluginStub()
    const store = new PersistPcmBufferStore({
      sessionId: "session-persist-2",
      startedAt: 22,
      storage: {
        mode: "persistent",
        persistenceChunkBytes: 1,
        persistencePlugin: persistence.plugin,
      },
      emitIssue: undefined,
    })
    await store.initialize()

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )
    await store.snapshot()
    store.appendFrame(
      createAudioFrame([new Float32Array([0.25, -0.25, 0.125])], 16_000, 20)
    )
    store.appendFrame(
      createAudioFrame([new Float32Array([0.75, -0.75])], 16_000, 30)
    )

    const snapshot = await store.snapshot()

    expect(persistence.appendSnapshot).toHaveBeenCalledTimes(3)
    expect(snapshot?.frameCount).toBe(3)
    expect(Array.from(snapshot?.planar[0] ?? [])).toEqual([
      0, 16384, -16384, 8192, -8192, 4096, 24575, -24576,
    ])
  })

  it("clears persisted data on reset to avoid stale cache growth", async () => {
    const persistence = createPluginStub()
    const store = new PersistPcmBufferStore({
      sessionId: "session-persist-3",
      startedAt: 3,
      storage: {
        mode: "persistent",
        persistencePlugin: persistence.plugin,
      },
      emitIssue: undefined,
    })
    await store.initialize()

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )
    await store.snapshot()
    await store.clear()

    expect(persistence.clear).toHaveBeenCalledTimes(1)
    expect(persistence.close).toHaveBeenCalledTimes(1)
    await expect(store.snapshot()).resolves.toBeUndefined()
  })

  it("fails initialization when persistent mode is requested without plugins", async () => {
    const emitIssue = vi.fn()
    const store = new PersistPcmBufferStore({
      sessionId: "session-persist-4",
      startedAt: 4,
      storage: {
        mode: "persistent",
      },
      emitIssue,
    })

    await expect(store.initialize()).rejects.toThrow(
      "Persistent storage mode requires an available persistence plugin before recording starts."
    )
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.PersistencePluginMissing,
        message:
          "Persistent storage mode was requested, but no persistence plugin was provided.",
      },
    })
  })

  it("emits unavailable warning when the configured persistence plugin is unsupported", async () => {
    const emitIssue = vi.fn()
    const store = new PersistPcmBufferStore({
      sessionId: "session-persist-5",
      startedAt: 5,
      storage: {
        mode: "persistent",
        persistencePlugin: {
          backend: "indexeddb",
          isSupported: () => false,
          createSession: async () => {
            throw new Error("should not be called")
          },
        },
      },
      emitIssue,
    })

    await expect(store.initialize()).rejects.toThrow(
      "Persistent storage mode requires an available persistence plugin before recording starts."
    )
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.PersistencePluginUnavailable,
        message:
          "The configured persistence plugin is not supported in this browser.",
      },
    })
  })

  it("emits activation warning when session creation fails", async () => {
    const emitIssue = vi.fn()
    const store = new PersistPcmBufferStore({
      sessionId: "session-persist-7",
      startedAt: 7,
      storage: {
        mode: "persistent",
        persistencePlugin: {
          backend: "indexeddb",
          isSupported: () => true,
          createSession: async () => {
            throw new Error("activation failed")
          },
        },
      },
      emitIssue,
    })

    await expect(store.initialize()).rejects.toThrow("activation failed")
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.PersistenceActivationFailed,
        message: "activation failed",
      },
    })
  })

  it("rejects appendFrame before initialize", () => {
    const persistence = createPluginStub()
    const store = new PersistPcmBufferStore({
      sessionId: "session-persist-8",
      startedAt: 8,
      storage: {
        mode: "persistent",
        persistencePlugin: persistence.plugin,
      },
      emitIssue: undefined,
    })

    expect(() =>
      store.appendFrame(
        createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
      )
    ).toThrow(
      "PersistPcmBufferStore must be initialized before accepting PCM data."
    )
  })

  it("surfaces write failures in snapshot and can recover after clear", async () => {
    const firstWrite = deferred<void>()
    const appendSnapshot = vi
      .fn<RecorderPersistenceSession["appendSnapshot"]>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(undefined)
    const clear = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    let latestSnapshots: RecorderPersistenceSession extends {
      readSnapshots: (...args: never[]) => Promise<infer TResult>
    }
      ? TResult
      : never = []

    const store = new PersistPcmBufferStore({
      sessionId: "session-persist-9",
      startedAt: 9,
      storage: {
        mode: "persistent",
        persistenceChunkBytes: 1,
        persistencePlugin: {
          backend: "indexeddb",
          isSupported: () => true,
          createSession: async () => ({
            appendSnapshot: async (snapshot) => {
              await appendSnapshot(snapshot)
              latestSnapshots = [...latestSnapshots, snapshot]
            },
            readSnapshots: async () => latestSnapshots,
            clear,
            close,
          }),
        },
      },
      emitIssue: undefined,
    })
    await store.initialize()

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )

    const pendingSnapshot = store.snapshot()
    firstWrite.reject(new Error("write failed"))

    await expect(pendingSnapshot).rejects.toThrow("write failed")

    await store.clear()

    const reinitializedStore = new PersistPcmBufferStore({
      sessionId: "session-persist-9b",
      startedAt: 10,
      storage: {
        mode: "persistent",
        persistenceChunkBytes: 1,
        persistencePlugin: {
          backend: "indexeddb",
          isSupported: () => true,
          createSession: async () => ({
            appendSnapshot: async (snapshot) => {
              latestSnapshots = [...latestSnapshots, snapshot]
            },
            readSnapshots: async () => latestSnapshots,
            clear: async () => {
              latestSnapshots = []
            },
            close: async () => {},
          }),
        },
      },
      emitIssue: undefined,
    })
    await reinitializedStore.initialize()
    reinitializedStore.appendFrame(
      createAudioFrame([new Float32Array([0.25, -0.25])], 16_000, 20)
    )

    const snapshot = await reinitializedStore.snapshot()
    expect(Array.from(snapshot?.planar[0] ?? [])).toEqual([8192, -8192])
  })
})
