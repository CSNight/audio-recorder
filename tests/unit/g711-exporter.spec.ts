import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import {
  exportG711Snapshot,
  g711ExportEncoder,
} from "@/codecs/g711/g711-snapshot-exporter"

function makeSnapshot(
  samples: number[],
  sampleRate = 8000,
  channels = 1
): PcmBufferSnapshot {
  const planar: Int16Array[] = []
  for (let c = 0; c < channels; c++) {
    planar.push(new Int16Array(samples))
  }
  return {
    sampleRate,
    channels,
    frameCount: 1,
    durationMs: (samples.length / sampleRate) * 1000,
    planar,
  }
}

describe("exportG711Snapshot", () => {
  it("exports A-law encoded data with correct metadata", () => {
    const snapshot = makeSnapshot([0, 1000, -1000, 500])
    const result = exportG711Snapshot(snapshot, { variant: "alaw" })

    expect(result.variant).toBe("alaw")
    expect(result.channels).toBe(1)
    expect(result.sampleRate).toBe(8000)
    expect(result.data).toBeInstanceOf(Uint8Array)
    expect(result.data.byteLength).toBe(4)
  })

  it("exports U-law encoded data with correct metadata", () => {
    const snapshot = makeSnapshot([0, 1000, -1000])
    const result = exportG711Snapshot(snapshot, { variant: "ulaw" })

    expect(result.variant).toBe("ulaw")
    expect(result.data.byteLength).toBe(3)
  })

  it("defaults to A-law when variant is not specified", () => {
    const snapshot = makeSnapshot([1000, -500])
    const defaultResult = exportG711Snapshot(snapshot)
    const alawResult = exportG711Snapshot(snapshot, { variant: "alaw" })

    expect(defaultResult.variant).toBe("alaw")
    expect(Array.from(defaultResult.data)).toEqual(Array.from(alawResult.data))
  })

  it("takes only first channel from stereo snapshot", () => {
    const monoSnap = makeSnapshot([100, 200, 300], 8000, 1)
    const stereoSnap: PcmBufferSnapshot = {
      sampleRate: 8000,
      channels: 2,
      frameCount: 1,
      durationMs: (3 / 8000) * 1000,
      planar: [
        new Int16Array([100, 200, 300]),
        new Int16Array([999, 999, 999]),
      ],
    }

    const monoResult = exportG711Snapshot(monoSnap)
    const stereoResult = exportG711Snapshot(stereoSnap)

    expect(Array.from(stereoResult.data)).toEqual(Array.from(monoResult.data))
  })

  it("resamples to 8000Hz when sampleRate option is specified", () => {
    // 输入 48000Hz 16 样本 → 目标 8000Hz（1/6），输出约 2-3 样本
    const snapshot = makeSnapshot(
      Array.from({ length: 48 }, (_, i) => i * 100),
      48000,
      1
    )
    const result = exportG711Snapshot(snapshot, { sampleRate: 8000 })

    expect(result.sampleRate).toBe(8000)
    // 重采样后样本数应约为输入的 1/6
    expect(result.data.byteLength).toBeLessThan(48)
    expect(result.data.byteLength).toBeGreaterThan(0)
  })

  it("all output bytes are within valid G.711 range 0-255", () => {
    const snapshot = makeSnapshot([-32768, -16384, 0, 16383, 32767], 8000, 1)
    const result = exportG711Snapshot(snapshot, { variant: "alaw" })

    for (const byte of result.data) {
      expect(byte).toBeGreaterThanOrEqual(0)
      expect(byte).toBeLessThanOrEqual(255)
    }
  })

  it("returns correct durationMs after resampling", () => {
    // 8000 样本 @ 8000Hz = 1000ms
    const snapshot = makeSnapshot(new Array(8000).fill(0), 8000, 1)
    const result = exportG711Snapshot(snapshot)
    expect(result.durationMs).toBeCloseTo(1000, 0)
  })

  it("g711ExportEncoder.export 透传到 exportG711Snapshot", () => {
    const snapshot = makeSnapshot([0, 1000, -1000, 500])
    const direct = exportG711Snapshot(snapshot, { variant: "ulaw" })
    const viaEncoder = g711ExportEncoder.export(snapshot, { variant: "ulaw" })

    expect(g711ExportEncoder.type).toBe("g711")
    expect(viaEncoder).toEqual(direct)
  })
})
