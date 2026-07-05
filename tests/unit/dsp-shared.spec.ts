import { describe, expect, it } from "vitest"
import {
  normalizePcmSample,
  denormalizePcmSample,
  createFrameFromPlanar,
} from "../../src/plugins/dsp/shared"

describe("normalizePcmSample", () => {
  it("normalizes positive sample", () => {
    expect(normalizePcmSample(32768)).toBeCloseTo(1, 5)
  })

  it("normalizes negative sample", () => {
    expect(normalizePcmSample(-32768)).toBeCloseTo(-1, 5)
  })

  it("normalizes zero", () => {
    expect(normalizePcmSample(0)).toBe(0)
  })

  it("clamps values above range", () => {
    expect(normalizePcmSample(65536)).toBe(1)
  })

  it("clamps values below range", () => {
    expect(normalizePcmSample(-65536)).toBe(-1)
  })
})

describe("denormalizePcmSample", () => {
  it("converts 1.0 to 32767", () => {
    expect(denormalizePcmSample(1)).toBe(32767)
  })

  it("converts -1.0 to -32768", () => {
    expect(denormalizePcmSample(-1)).toBe(-32768)
  })

  it("converts 0 to 0", () => {
    expect(denormalizePcmSample(0)).toBe(0)
  })

  it("clamps values above 1", () => {
    expect(denormalizePcmSample(2)).toBe(32767)
  })

  it("clamps values below -1", () => {
    expect(denormalizePcmSample(-2)).toBe(-32768)
  })
})

describe("createFrameFromPlanar", () => {
  it("creates a frame with correct metadata", () => {
    const planar = [new Int16Array(160), new Int16Array(160)]
    const frame = createFrameFromPlanar(planar, 16000, 0)
    expect(frame.channels).toBe(2)
    expect(frame.sampleRate).toBe(16000)
    expect(frame.timestamp).toBe(0)
    expect(frame.durationMs).toBeCloseTo(10, 5) // 160/16000*1000 = 10ms
    expect(frame.planar).toBe(planar)
  })

  it("handles empty planar array", () => {
    const frame = createFrameFromPlanar([], 16000, 100)
    expect(frame.channels).toBe(0)
    expect(frame.durationMs).toBe(0)
  })

  it("handles empty channel data", () => {
    const planar = [new Int16Array(0)]
    const frame = createFrameFromPlanar(planar, 16000, 0)
    expect(frame.durationMs).toBe(0)
  })
})
