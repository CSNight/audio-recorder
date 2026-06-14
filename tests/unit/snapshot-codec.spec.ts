import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import {
  deserializePcmSnapshot,
  serializePcmSnapshot,
} from "@/storage/snapshot-codec"

describe("snapshot codec", () => {
  it("serializes and deserializes stereo PCM snapshots", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 48_000,
      channels: 2,
      frameCount: 2,
      durationMs: 0.5,
      planar: [new Int16Array([100, 200]), new Int16Array([-100, -200])],
    }

    const encoded = serializePcmSnapshot(snapshot)
    const decoded = deserializePcmSnapshot(encoded)

    expect(decoded.sampleRate).toBe(48_000)
    expect(decoded.channels).toBe(2)
    expect(decoded.frameCount).toBe(2)
    expect(decoded.durationMs).toBe(0.5)
    expect(Array.from(decoded.planar[0] ?? [])).toEqual([100, 200])
    expect(Array.from(decoded.planar[1] ?? [])).toEqual([-100, -200])
  })
})
