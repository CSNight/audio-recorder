import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import { resamplePlanarPcm } from "@/utils/resample"

describe("resamplePlanarPcm", () => {
  it("keeps planar PCM unchanged when the sampleRate does not change", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 1,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([0, 1000, -1000, 500])],
    }

    const result = resamplePlanarPcm(snapshot, 16_000)

    expect(result.sampleRate).toBe(16_000)
    expect(Array.from(result.planar[0] ?? [])).toEqual([0, 1000, -1000, 500])
  })

  it("downsamples planar PCM and preserves stereo channel layout", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 48_000,
      channels: 2,
      frameCount: 2,
      durationMs: 1,
      planar: [
        new Int16Array([0, 1000, 2000, 3000, 4000, 5000]),
        new Int16Array([0, -1000, -2000, -3000, -4000, -5000]),
      ],
    }

    const result = resamplePlanarPcm(snapshot, 16_000)

    expect(result.sampleRate).toBe(16_000)
    expect(result.channels).toBe(2)
    expect(Array.from(result.planar[0] ?? [])).toEqual([0, 3000])
    expect(Array.from(result.planar[1] ?? [])).toEqual([0, -3000])
  })

  it("rejects non-positive target sampleRate values", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 1,
      frameCount: 1,
      durationMs: 1,
      planar: [new Int16Array([0, 1000])],
    }

    expect(() => resamplePlanarPcm(snapshot, 0)).toThrow(
      "Resample target sampleRate must be positive, received 0."
    )
  })
})
