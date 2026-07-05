import { describe, expect, it } from "vitest"
import { resample } from "../../src"

function makeSnapshot(samples: number[], sampleRate = 16000, channels = 1) {
  const planar: Int16Array[] = []
  for (let c = 0; c < channels; c++) {
    const ch = new Int16Array(samples.length / channels)
    for (let i = 0; i < ch.length; i++) {
      ch[i] = samples[c + i * channels] ?? 0
    }
    planar.push(ch)
  }
  const durationMs = (samples.length / channels / sampleRate) * 1000
  const frameCount = planar[0]?.length ?? 0
  return { planar, sampleRate, channels, frameCount, durationMs, timestamp: 0 }
}

describe("resample", () => {
  it("throws for non-positive target sample rate", () => {
    const snap = makeSnapshot([100, 200], 16000, 1)
    expect(() => resample(snap, 0)).toThrow("positive")
    expect(() => resample(snap, -1)).toThrow("positive")
  })

  it("throws when snapshot has no channels", () => {
    const snap = {
      planar: [],
      sampleRate: 16000,
      channels: 0,
      frameCount: 0,
      durationMs: 0,
      timestamp: 0,
    }
    expect(() => resample(snap, 8000)).toThrow("channel")
  })

  it("returns copy when target equals source sample rate", () => {
    const snap = makeSnapshot([1000, 2000, 3000, 4000], 16000, 1)
    const result = resample(snap, 16000)
    expect(result.sampleRate).toBe(16000)
    expect(result.channels).toBe(1)
    expect(Array.from(result.planar[0]!)).toEqual([1000, 2000, 3000, 4000])
  })

  it("downsamples (LQ) mono from 16000 to 8000", () => {
    const input = Array.from({ length: 320 }, (_, i) =>
      Math.round(Math.sin(i / 10) * 10000)
    )
    const snap = makeSnapshot(input, 16000, 1)
    const result = resample(snap, 8000)
    expect(result.sampleRate).toBe(8000)
    expect(result.planar[0]!.length).toBeCloseTo(160, -1)
    expect(result.durationMs).toBeCloseTo(20, 0)
  })

  it("upsamples (LQ) mono from 8000 to 16000", () => {
    const input = Array.from({ length: 160 }, (_, i) =>
      Math.round(Math.sin(i / 5) * 10000)
    )
    const snap = makeSnapshot(input, 8000, 1)
    const result = resample(snap, 16000)
    expect(result.sampleRate).toBe(16000)
    expect(result.planar[0]!.length).toBeCloseTo(320, -1)
  })

  it("downsamples (HQ) mono from 44100 to 16000", () => {
    const input = Array.from({ length: 4410 }, (_, i) =>
      Math.round(Math.sin(i / 50) * 10000)
    )
    const snap = makeSnapshot(input, 44100, 1)
    const result = resample(snap, 16000, { isHQ: true })
    expect(result.sampleRate).toBe(16000)
    expect(result.planar[0]!.length).toBeGreaterThan(0)
  })

  it("upsamples (HQ) mono from 8000 to 16000", () => {
    const input = Array.from({ length: 160 }, (_, i) =>
      Math.round(Math.sin(i / 5) * 10000)
    )
    const snap = makeSnapshot(input, 8000, 1)
    const result = resample(snap, 16000, { isHQ: true })
    expect(result.sampleRate).toBe(16000)
    expect(result.planar[0]!.length).toBeGreaterThan(0)
  })

  it("handles stereo downsampling", () => {
    const input = Array.from({ length: 640 }, (_, i) =>
      i % 2 === 0 ? 5000 : -5000
    )
    const snap = makeSnapshot(input, 16000, 2)
    const result = resample(snap, 8000)
    expect(result.channels).toBe(2)
    expect(result.planar).toHaveLength(2)
    expect(result.planar[0]!.length).toBeGreaterThan(0)
  })

  it("handles stereo upsampling", () => {
    const input = Array.from({ length: 320 }, (_, i) =>
      i % 2 === 0 ? 5000 : -5000
    )
    const snap = makeSnapshot(input, 8000, 2)
    const result = resample(snap, 16000)
    expect(result.channels).toBe(2)
    expect(result.planar).toHaveLength(2)
  })

  it("downsamples with custom filterHalfTaps (HQ)", () => {
    const input = Array.from({ length: 880 }, (_, i) =>
      Math.round(Math.sin(i / 20) * 10000)
    )
    const snap = makeSnapshot(input, 44100, 1)
    const result = resample(snap, 16000, { isHQ: true, filterHalfTaps: 32 })
    expect(result.sampleRate).toBe(16000)
    expect(result.planar[0]!.length).toBeGreaterThan(0)
  })

  it("handles single-sample input", () => {
    const snap = makeSnapshot([12345], 16000, 1)
    const result = resample(snap, 8000)
    expect(result.planar[0]!.length).toBeGreaterThan(0)
  })
})
