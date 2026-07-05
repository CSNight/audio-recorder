import { describe, expect, it } from "vitest"
import {
  isPositiveIntegerSampleRate,
  pickNearestSupportedSampleRate,
} from "../../src"

describe("isPositiveIntegerSampleRate", () => {
  it("returns true for positive integers", () => {
    expect(isPositiveIntegerSampleRate(16000)).toBe(true)
    expect(isPositiveIntegerSampleRate(44100)).toBe(true)
    expect(isPositiveIntegerSampleRate(1)).toBe(true)
  })

  it("returns false for zero", () => {
    expect(isPositiveIntegerSampleRate(0)).toBe(false)
  })

  it("returns false for negative integers", () => {
    expect(isPositiveIntegerSampleRate(-1)).toBe(false)
    expect(isPositiveIntegerSampleRate(-44100)).toBe(false)
  })

  it("returns false for non-integers", () => {
    expect(isPositiveIntegerSampleRate(44100.5)).toBe(false)
    expect(isPositiveIntegerSampleRate(NaN)).toBe(false)
    expect(isPositiveIntegerSampleRate(Infinity)).toBe(false)
  })
})

describe("pickNearestSupportedSampleRate", () => {
  const supported = [8000, 16000, 22050, 44100, 48000] as const

  it("returns exact match when available", () => {
    expect(pickNearestSupportedSampleRate(16000, supported)).toBe(16000)
    expect(pickNearestSupportedSampleRate(48000, supported)).toBe(48000)
  })

  it("returns the nearest sample rate", () => {
    expect(pickNearestSupportedSampleRate(15000, supported)).toBe(16000)
    expect(pickNearestSupportedSampleRate(9000, supported)).toBe(8000)
    expect(pickNearestSupportedSampleRate(46000, supported)).toBe(44100)
  })

  it("prefers the lower value on tie", () => {
    // 12000 is equidistant from 8000 and 16000
    expect(pickNearestSupportedSampleRate(12000, supported)).toBe(8000)
  })

  it("throws for non-positive-integer sample rate", () => {
    expect(() => pickNearestSupportedSampleRate(0, supported)).toThrow(
      RangeError
    )
    expect(() => pickNearestSupportedSampleRate(-1, supported)).toThrow(
      RangeError
    )
    expect(() => pickNearestSupportedSampleRate(1.5, supported)).toThrow(
      RangeError
    )
  })

  it("throws for empty supported list", () => {
    expect(() => pickNearestSupportedSampleRate(16000, [])).toThrow(RangeError)
  })

  it("works with a single supported rate", () => {
    expect(pickNearestSupportedSampleRate(99999, [16000])).toBe(16000)
  })
})
