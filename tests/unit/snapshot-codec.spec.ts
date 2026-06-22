import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import {
  deserializePcmSnapshot,
  serializePcmSnapshot,
} from "@/utils/snapshot-codec"

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

  it("round-trips mono snapshots with empty channel payloads", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 1,
      frameCount: 0,
      durationMs: 0,
      planar: [new Int16Array(0)],
    }

    const decoded = deserializePcmSnapshot(serializePcmSnapshot(snapshot))

    expect(decoded).toEqual(snapshot)
    expect(decoded.planar[0]).not.toBe(snapshot.planar[0])
  })

  it("rejects unsupported snapshot versions", () => {
    const encoded = serializePcmSnapshot({
      sampleRate: 16_000,
      channels: 1,
      frameCount: 1,
      durationMs: 1,
      planar: [new Int16Array([1])],
    })
    const view = new DataView(encoded)
    view.setUint32(0, 99, true)

    expect(() => deserializePcmSnapshot(encoded)).toThrow(
      "Unsupported PCM snapshot version 99."
    )
  })

  it("rejects unsupported channel counts while decoding", () => {
    const encoded = serializePcmSnapshot({
      sampleRate: 16_000,
      channels: 1,
      frameCount: 1,
      durationMs: 1,
      planar: [new Int16Array([1])],
    })
    const view = new DataView(encoded)
    view.setUint8(8, 3)

    expect(() => deserializePcmSnapshot(encoded)).toThrow(
      "Unsupported PCM snapshot channel count 3."
    )
  })
})
