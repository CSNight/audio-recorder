import { describe, expect, it } from "vitest"
import { encodeAlaw, encodeUlaw } from "../../src/codecs/g711/g711-encoder"

describe("encodeAlaw", () => {
  it("encodes silence (0) to a fixed value", () => {
    const result = encodeAlaw(0)
    expect(typeof result).toBe("number")
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(255)
  })

  it("encodes positive samples without throwing", () => {
    expect(() => encodeAlaw(1000)).not.toThrow()
    expect(() => encodeAlaw(32767)).not.toThrow()
  })

  it("encodes negative samples without throwing", () => {
    expect(() => encodeAlaw(-1000)).not.toThrow()
    expect(() => encodeAlaw(-32768)).not.toThrow()
  })

  it("clamps values beyond int16 range", () => {
    const r1 = encodeAlaw(99999)
    const r2 = encodeAlaw(32767)
    expect(r1).toBe(r2)
    const r3 = encodeAlaw(-99999)
    const r4 = encodeAlaw(-32768)
    expect(r3).toBe(r4)
  })

  it("produces values in 0-255 range for all boundary inputs", () => {
    for (const sample of [-32768, -1, 0, 1, 32767]) {
      const result = encodeAlaw(sample)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(255)
    }
  })
})

describe("encodeUlaw", () => {
  it("encodes silence (0) to a fixed value", () => {
    const result = encodeUlaw(0)
    expect(typeof result).toBe("number")
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(255)
  })

  it("encodes positive samples without throwing", () => {
    expect(() => encodeUlaw(1000)).not.toThrow()
    expect(() => encodeUlaw(32767)).not.toThrow()
  })

  it("encodes negative samples without throwing", () => {
    expect(() => encodeUlaw(-1000)).not.toThrow()
    expect(() => encodeUlaw(-32768)).not.toThrow()
  })

  it("clamps values beyond int16 range", () => {
    const r1 = encodeUlaw(99999)
    const r2 = encodeUlaw(32767)
    expect(r1).toBe(r2)
  })

  it("produces values in 0-255 range for all boundary inputs", () => {
    for (const sample of [-32768, -1, 0, 1, 32767]) {
      const result = encodeUlaw(sample)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThanOrEqual(255)
    }
  })
})
