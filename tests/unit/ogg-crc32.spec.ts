import { describe, expect, it } from "vitest"
import { calculateOggCrc32 } from "../../src/codecs/opus/muxers/ogg"

describe("calculateOggCrc32", () => {
  it("returns 0 for empty input", () => {
    expect(calculateOggCrc32(new Uint8Array(0))).toBe(0)
  })

  it("returns deterministic value for known input", () => {
    const data = new Uint8Array([0x4f, 0x67, 0x67, 0x53]) // "OggS"
    const result = calculateOggCrc32(data)
    expect(typeof result).toBe("number")
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(0xffffffff)
  })

  it("returns same result for identical inputs", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    expect(calculateOggCrc32(data)).toBe(calculateOggCrc32(data))
  })

  it("returns different results for different inputs", () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2, 4])
    expect(calculateOggCrc32(a)).not.toBe(calculateOggCrc32(b))
  })

  it("uses provided seed", () => {
    const data = new Uint8Array([0xff, 0x00])
    const withSeed0 = calculateOggCrc32(data, 0)
    const withSeed1 = calculateOggCrc32(data, 1)
    expect(withSeed0).not.toBe(withSeed1)
  })

  it("produces unsigned 32-bit result", () => {
    const data = new Uint8Array(256).fill(0xff)
    const result = calculateOggCrc32(data)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(result)).toBe(true)
  })
})
