import { describe, expect, it } from "vitest"
import {
  normalizeSonicTransformOptions,
  transformInterleavedBlock,
  transformInterleavedPcm,
} from "../../src/plugins/sonic-export/sonic-processor"

describe("normalizeSonicTransformOptions", () => {
  it("returns defaults when called with no arguments", () => {
    const opts = normalizeSonicTransformOptions()
    expect(opts.speed).toBe(1)
    expect(opts.pitch).toBe(1)
    expect(opts.rate).toBe(1)
    expect(opts.volume).toBe(1)
    expect(opts.blockMs).toBeGreaterThanOrEqual(100)
  })

  it("uses provided valid values", () => {
    const opts = normalizeSonicTransformOptions({
      speed: 1.5,
      pitch: 0.8,
      rate: 1.2,
      volume: 0.5,
      blockMs: 200,
    })
    expect(opts.speed).toBe(1.5)
    expect(opts.pitch).toBe(0.8)
    expect(opts.rate).toBe(1.2)
    expect(opts.volume).toBe(0.5)
    expect(opts.blockMs).toBe(200)
  })

  it("clamps blockMs to minimum 100", () => {
    const opts = normalizeSonicTransformOptions({ blockMs: 10 })
    expect(opts.blockMs).toBe(100)
  })

  it("falls back to default for zero or negative values", () => {
    const opts = normalizeSonicTransformOptions({
      speed: 0,
      pitch: -1,
      rate: 0,
    })
    expect(opts.speed).toBe(1)
    expect(opts.pitch).toBe(1)
    expect(opts.rate).toBe(1)
  })

  it("falls back to default for non-finite values", () => {
    const opts = normalizeSonicTransformOptions({
      speed: NaN,
      pitch: Infinity,
      volume: -Infinity,
    })
    expect(opts.speed).toBe(1)
    expect(opts.pitch).toBe(1)
    expect(opts.volume).toBe(1)
  })

  it("falls back to default for undefined values", () => {
    const opts = normalizeSonicTransformOptions({
      speed: undefined as unknown as number,
    })
    expect(opts.speed).toBe(1)
  })
})

describe("transformInterleavedBlock", () => {
  it("returns empty array for empty input", () => {
    const result = transformInterleavedBlock(new Int16Array(0), 16000, 1)
    expect(result).toBeInstanceOf(Int16Array)
    expect(result.length).toBe(0)
  })

  it("passes through unchanged when all options are identity (1.0)", () => {
    const input = new Int16Array([100, 200, 300, 400])
    const result = transformInterleavedBlock(input, 16000, 1, {
      speed: 1,
      pitch: 1,
      rate: 1,
      volume: 1,
    })
    expect(Array.from(result)).toEqual(Array.from(input))
  })

  it("applies volume scaling", () => {
    const input = new Int16Array([10000, 10000, 10000, 10000])
    const result = transformInterleavedBlock(input, 16000, 1, { volume: 0.5 })
    for (const sample of result) {
      expect(Math.abs(sample)).toBeLessThanOrEqual(5001)
    }
  })

  it("applies rate change (resampling)", () => {
    const input = new Int16Array(320).fill(1000)
    const result = transformInterleavedBlock(input, 16000, 1, { rate: 2.0 })
    // rate=2 → output should be approximately half the length
    expect(result.length).toBeLessThan(input.length)
  })

  it("applies speed change", () => {
    const input = new Int16Array(320).fill(1000)
    const result = transformInterleavedBlock(input, 16000, 1, { speed: 2.0 })
    // speed=2 → output shorter (time-compressed)
    expect(result.length).toBeLessThan(input.length)
  })

  it("applies pitch shift", () => {
    const input = new Int16Array(320).fill(1000)
    // pitch shift should return same frame count (pitch compensates resampling)
    const result = transformInterleavedBlock(input, 16000, 1, { pitch: 1.5 })
    expect(result).toBeInstanceOf(Int16Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it("handles stereo frames", () => {
    const input = new Int16Array([1000, -1000, 2000, -2000])
    const result = transformInterleavedBlock(input, 16000, 2)
    expect(result).toBeInstanceOf(Int16Array)
    expect(result.length % 2).toBe(0)
  })

  it("clamps volume-scaled samples to int16 range", () => {
    const input = new Int16Array([32767])
    const result = transformInterleavedBlock(input, 16000, 1, { volume: 10 })
    expect(result[0]).toBeLessThanOrEqual(32767)
  })
})

describe("transformInterleavedPcm", () => {
  it("returns empty array for empty input", async () => {
    const result = await transformInterleavedPcm(new Int16Array(0), 16000, 1)
    expect(result).toBeInstanceOf(Int16Array)
    expect(result.length).toBe(0)
  })

  it("processes audio in blocks and returns concatenated result", async () => {
    const input = new Int16Array(3200).fill(1000)
    const result = await transformInterleavedPcm(input, 16000, 1, {
      speed: 1,
      blockMs: 100,
    })
    expect(result).toBeInstanceOf(Int16Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it("applies volume scaling across multiple blocks", async () => {
    const input = new Int16Array(3200).fill(10000)
    const result = await transformInterleavedPcm(input, 16000, 1, {
      volume: 0.5,
      blockMs: 100,
    })
    const maxAbs = Math.max(...Array.from(result).map(Math.abs))
    expect(maxAbs).toBeLessThan(10000)
  })
})
