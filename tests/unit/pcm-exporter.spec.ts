import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import { exportPcmSnapshot } from "@/codecs/pcm/pcm-exporter"

describe("exportPcmSnapshot", () => {
  it("exports mono PCM as interleaved Int16 data by default", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 1,
      frameCount: 2,
      durationMs: 0.5,
      planar: [new Int16Array([0, 1000, -1000, 500])],
    }

    const result = exportPcmSnapshot(snapshot)

    expect(result.sampleRate).toBe(16_000)
    expect(result.channels).toBe(1)
    expect(result.bitRate).toBe(16)
    expect(result.data).toBeInstanceOf(Int16Array)
    expect(Array.from(result.data)).toEqual([0, 1000, -1000, 500])
  })

  it("exports stereo PCM as interleaved Int16 samples", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 48_000,
      channels: 2,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([1000, 2000]), new Int16Array([-1000, -2000])],
    }

    const result = exportPcmSnapshot(snapshot)

    expect(Array.from(result.data)).toEqual([1000, -1000, 2000, -2000])
  })

  it("supports exporting 8-bit PCM and resampled output", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 48_000,
      channels: 1,
      frameCount: 1,
      durationMs: 0.125,
      planar: [new Int16Array([0, 256, 512, 768, 1024, 1280])],
    }

    const result = exportPcmSnapshot(snapshot, {
      sampleRate: 16_000,
      bitRate: 8,
    })

    expect(result.sampleRate).toBe(16_000)
    expect(result.bitRate).toBe(8)
    expect(result.data).toBeInstanceOf(Int8Array)
    expect(Array.from(result.data)).toEqual([0, 3])
  })

  it("rejects unsupported PCM export bitRate values", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 1,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([0, 1000])],
    }

    expect(() =>
      exportPcmSnapshot(snapshot, {
        bitRate: 12 as 8 | 16,
      })
    ).toThrow("PCM export bitRate 12 is not supported.")
  })
})
