import { describe, expect, it, vi } from "vitest"
import { ComplexPcmBufferStore } from "../../src/buffer/complex-pcm-buffer-store"
import type {
  RecorderPersistencePlugin,
  RecorderPersistenceSession,
} from "../../src"
import { RecorderWarningCode } from "../../src"
import { createAudioFrame } from "../../src/utils/audio-frame"

function createPluginStub(): {
  plugin: RecorderPersistencePlugin
  appendSnapshot: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
} {
  let latestSnapshots: Awaited<
    ReturnType<RecorderPersistenceSession["readSnapshots"]>
  > = []
  const appendSnapshot = vi.fn(async (snapshot) => {
    latestSnapshots = [...latestSnapshots, snapshot]
  })
  const clear = vi.fn(async () => {
    latestSnapshots = []
  })
  const close = vi.fn(async () => {})

  return {
    plugin: {
      backend: "indexeddb",
      isSupported: () => true,
      createSession: async () => ({
        appendSnapshot,
        readSnapshots: async () => latestSnapshots,
        clear,
        close,
      }),
    },
    appendSnapshot,
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

describe("ComplexPcmBufferStore", () => {
  it("keeps writing to the memory store when auto mode never crosses the threshold", async () => {
    const store = new ComplexPcmBufferStore({
      sessionId: "session-complex-1",
      startedAt: 1,
      storage: {
        mode: "auto",
        memoryThresholdBytes: 0,
      },
      emitIssue: undefined,
    })

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )

    const snapshot = await store.snapshot()

    expect(snapshot?.frameCount).toBe(1)
    expect(snapshot?.sampleRate).toBe(16_000)
  })

  it("promotes buffered history into the persist store once the threshold is exceeded", async () => {
    const persistence = createPluginStub()
    const store = new ComplexPcmBufferStore({
      sessionId: "session-complex-2",
      startedAt: 2,
      storage: {
        mode: "auto",
        memoryThresholdBytes: 1,
        persistencePlugin: persistence.plugin,
      },
      emitIssue: undefined,
    })

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )

    const snapshot = await store.snapshot()

    expect(persistence.appendSnapshot).toHaveBeenCalledTimes(1)
    expect(snapshot?.frameCount).toBe(1)
  })

  it("does not touch the persist store before the threshold is exceeded", async () => {
    const persistence = createPluginStub()
    const store = new ComplexPcmBufferStore({
      sessionId: "session-complex-3",
      startedAt: 23,
      storage: {
        mode: "auto",
        memoryThresholdBytes: 1024,
        persistencePlugin: persistence.plugin,
      },
      emitIssue: undefined,
    })

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )

    const snapshot = await store.snapshot()

    expect(persistence.appendSnapshot).toHaveBeenCalledTimes(0)
    expect(snapshot?.frameCount).toBe(1)
  })

  it("clears persisted state after auto mode has switched to persistence", async () => {
    const persistence = createPluginStub()
    const store = new ComplexPcmBufferStore({
      sessionId: "session-complex-4",
      startedAt: 4,
      storage: {
        mode: "auto",
        memoryThresholdBytes: 1,
        persistencePlugin: persistence.plugin,
      },
      emitIssue: undefined,
    })

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )
    await store.snapshot()
    await store.clear()

    expect(persistence.clear).toHaveBeenCalledTimes(1)
    expect(persistence.close).toHaveBeenCalledTimes(1)
  })

  it("keeps frames in memory when promotion initialization fails", async () => {
    const emitIssue = vi.fn()
    const store = new ComplexPcmBufferStore({
      sessionId: "session-complex-5",
      startedAt: 5,
      storage: {
        mode: "auto",
        memoryThresholdBytes: 1,
        persistencePlugin: {
          backend: "indexeddb",
          isSupported: () => true,
          createSession: async () => {
            throw new Error("promotion failed")
          },
        },
      },
      emitIssue,
    })

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )

    const snapshot = await store.snapshot()

    expect(snapshot?.frameCount).toBe(1)
    expect(Array.from(snapshot?.planar[0] ?? [])).toEqual([0, 16384, -16384])
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.PersistenceActivationFailed,
        message: "promotion failed",
      },
    })
  })

  it("flushes frames buffered during promotion into persistence once activation completes", async () => {
    const createSessionGate = deferred<RecorderPersistenceSession>()
    let latestSnapshots: Awaited<
      ReturnType<RecorderPersistenceSession["readSnapshots"]>
    > = []
    const appendSnapshot = vi.fn(async (snapshot) => {
      latestSnapshots = [...latestSnapshots, snapshot]
    })

    const store = new ComplexPcmBufferStore({
      sessionId: "session-complex-6",
      startedAt: 6,
      storage: {
        mode: "auto",
        memoryThresholdBytes: 1,
        persistencePlugin: {
          backend: "indexeddb",
          isSupported: () => true,
          createSession: () => createSessionGate.promise,
        },
      },
      emitIssue: undefined,
    })

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )
    store.appendFrame(
      createAudioFrame([new Float32Array([0.25, -0.25])], 16_000, 20)
    )

    createSessionGate.resolve({
      appendSnapshot,
      readSnapshots: async () => latestSnapshots,
      clear: async () => {
        latestSnapshots = []
      },
      close: async () => {},
    })

    const snapshot = await store.snapshot()

    expect(appendSnapshot).toHaveBeenCalledTimes(2)
    expect(snapshot?.frameCount).toBe(2)
    expect(Array.from(snapshot?.planar[0] ?? [])).toEqual([
      0, 16384, -16384, 8192, -8192,
    ])
  })
})
