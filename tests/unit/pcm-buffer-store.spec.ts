import { describe, expect, it } from "vitest"
import { ComplexPcmBufferStore } from "@/buffer/complex-pcm-buffer-store"
import { InMemoryPcmBufferStore } from "@/buffer/in-memory-pcm-buffer-store"
import { createPcmBufferStore } from "@/buffer/pcm-buffer-store"
import { PersistPcmBufferStore } from "@/buffer/persist-pcm-buffer-store"
import { createAudioFrame } from "@/utils/audio-frame"

describe("InMemoryPcmBufferStore", () => {
  it("appends frames and returns a merged snapshot", () => {
    const store = new InMemoryPcmBufferStore()

    store.appendFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
    )
    store.appendFrame(
      createAudioFrame([new Float32Array([0.25, -0.25])], 16_000, 20)
    )

    const snapshot = store.snapshot()

    expect(snapshot).not.toBeNull()
    expect(snapshot?.sampleRate).toBe(16_000)
    expect(snapshot?.channels).toBe(1)
    expect(snapshot?.frameCount).toBe(2)
    expect(snapshot?.durationMs).toBeGreaterThan(0)
    expect(Array.from(snapshot?.planar[0] ?? [])).toEqual([
      0, 16384, -16384, 8192, -8192,
    ])
  })

  it("supports stereo frames and can clear state", () => {
    const store = new InMemoryPcmBufferStore()

    store.appendFrame(
      createAudioFrame(
        [new Float32Array([0.5, -0.5]), new Float32Array([-0.25, 0.25])],
        48_000,
        10
      )
    )

    const snapshot = store.snapshot()
    expect(snapshot?.channels).toBe(2)
    expect(Array.from(snapshot?.planar[0] ?? [])).toEqual([16384, -16384])
    expect(Array.from(snapshot?.planar[1] ?? [])).toEqual([-8192, 8192])

    store.clear()
    expect(store.snapshot()).toBeUndefined()
  })

  it("returns detached snapshots so caller mutation does not pollute cached merges", () => {
    const store = new InMemoryPcmBufferStore()

    store.appendFrame(
      createAudioFrame([new Float32Array([0.5, -0.5])], 16_000, 10)
    )

    const firstSnapshot = store.snapshot()
    expect(firstSnapshot).toBeDefined()
    if (!firstSnapshot) {
      throw new Error("Expected a snapshot after appending PCM data.")
    }

    firstSnapshot.planar[0]?.fill(0)

    const secondSnapshot = store.snapshot()

    expect(Array.from(secondSnapshot?.planar[0] ?? [])).toEqual([16384, -16384])
  })

  it("rejects frames whose sampleRate or channel layout changes mid-stream", () => {
    const store = new InMemoryPcmBufferStore()

    store.appendFrame(
      createAudioFrame([new Float32Array([0.5, -0.5])], 16_000, 10)
    )

    expect(() =>
      store.appendFrame(
        createAudioFrame([new Float32Array([0.25])], 48_000, 20)
      )
    ).toThrow("PCM buffer store received sampleRate 48000, expected 16000.")

    expect(() =>
      store.appendFrame(
        createAudioFrame(
          [new Float32Array([0.25]), new Float32Array([-0.25])],
          16_000,
          30
        )
      )
    ).toThrow("PCM buffer store received 2 channel(s), expected 1.")
  })
})

describe("createPcmBufferStore", () => {
  it("creates an in-memory store by default", () => {
    const store = createPcmBufferStore({
      sessionId: "session-factory-1",
      startedAt: 1,
      storage: undefined,
      emitIssue: undefined,
    })

    expect(store).toBeInstanceOf(InMemoryPcmBufferStore)
  })

  it("creates a persistent store when persistent mode is requested", () => {
    const store = createPcmBufferStore({
      sessionId: "session-factory-2",
      startedAt: 2,
      storage: {
        mode: "persistent",
      },
      emitIssue: undefined,
    })

    expect(store).toBeInstanceOf(PersistPcmBufferStore)
  })

  it("creates a complex store when auto mode is requested", () => {
    const store = createPcmBufferStore({
      sessionId: "session-factory-3",
      startedAt: 3,
      storage: {
        mode: "auto",
      },
      emitIssue: undefined,
    })

    expect(store).toBeInstanceOf(ComplexPcmBufferStore)
  })
})
