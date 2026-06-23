import { describe, expect, it } from "vitest"
import { g711ChunkedEncoderDefinition } from "@/codecs/g711/g711-chunked-encoder"
import { encodeAlaw, encodeUlaw } from "@/codecs/g711/g711-encoder"

function mono(samples: number[]): Int16Array[] {
  return [new Int16Array(samples)]
}

function stereo(left: number[], right: number[]): Int16Array[] {
  return [new Int16Array(left), new Int16Array(right)]
}

// ITU-T G.711 已知参考值（来自规范附录）
// 这些值通过标准算法手动计算验证
describe("G.711 A-law encoder algorithm", () => {
  it("encodes silence (0) correctly", () => {
    // 0 → A-law 值应为 0xD5（213）
    expect(encodeAlaw(0)).toBe(0xd5)
  })

  it("encodes positive maximum (32767) without overflow", () => {
    const result = encodeAlaw(32767)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(255)
  })

  it("encodes negative minimum (-32768) without overflow", () => {
    const result = encodeAlaw(-32768)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(255)
  })

  it("positive and negative samples produce different sign bits", () => {
    const pos = encodeAlaw(1000)
    const neg = encodeAlaw(-1000)
    // A-law：sign bit 在 bit 7（0x80），正样本有符号位，负样本无符号位
    expect(pos & 0x80).toBe(0x80)
    expect(neg & 0x80).toBe(0x00)
  })
})

describe("G.711 U-law encoder algorithm", () => {
  it("encodes silence (0) correctly", () => {
    // 0 → U-law 值应为 0xFF（255）
    expect(encodeUlaw(0)).toBe(0xff)
  })

  it("encodes positive maximum (32767) without overflow", () => {
    const result = encodeUlaw(32767)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(255)
  })

  it("encodes negative minimum (-32768) without overflow", () => {
    const result = encodeUlaw(-32768)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(255)
  })

  it("positive and negative samples produce different sign bits", () => {
    const pos = encodeUlaw(1000)
    const neg = encodeUlaw(-1000)
    // U-law 正数 mask=0xFF XOR 后 bit7=1；负数 mask=0x7F XOR 后 bit7=0
    expect(pos & 0x80).toBe(0x80)
    expect(neg & 0x80).toBe(0x00)
  })

  it("larger magnitude produces smaller quantization value (log compression)", () => {
    // 正数：mask=0xFF，XOR 后低 7 位 = ~(seg<<4 | mantissa) & 0x7F
    // 幅度越大 seg 越大，XOR 后低 7 位越小（越接近 0）
    const small = encodeUlaw(200) & 0x7f
    const large = encodeUlaw(20000) & 0x7f
    expect(large).toBeLessThan(small)
  })
})

describe("G.711 ChunkedEncoder (A-law)", () => {
  it("encodes mono frame immediately with no buffering", () => {
    const enc = g711ChunkedEncoderDefinition.create({ variant: "alaw" })
    const result = enc.feedFrame(1, 8000, mono([0, 1000, -1000]))

    expect(result).not.toBeNull()
    expect(result!.byteLength).toBe(3)
    // 每个字节应在有效 G.711 范围内
    expect(result![0]).toBeGreaterThanOrEqual(0)
    expect(result![0]).toBeLessThanOrEqual(255)
  })

  it("flush always returns null (G.711 has no internal buffer)", () => {
    const enc = g711ChunkedEncoderDefinition.create({ variant: "alaw" })
    enc.feedFrame(1, 8000, mono([100, 200]))
    expect(enc.flush()).toBeNull()
  })

  it("returns null for empty frame", () => {
    const enc = g711ChunkedEncoderDefinition.create({ variant: "alaw" })
    expect(enc.feedFrame(1, 8000, mono([]))).toBeNull()
  })

  it("takes only first channel from stereo input", () => {
    const enc = g711ChunkedEncoderDefinition.create({ variant: "alaw" })
    const monoResult = g711ChunkedEncoderDefinition
      .create({ variant: "alaw" })
      .feedFrame(1, 8000, mono([100, 200, 300]))
    const stereoResult = enc.feedFrame(
      2,
      8000,
      stereo([100, 200, 300], [999, 999, 999])
    )

    // 输出应等同于只处理左声道
    expect(stereoResult).toEqual(monoResult)
  })

  it("output length equals input sample count", () => {
    const enc = g711ChunkedEncoderDefinition.create({ variant: "alaw" })
    const result = enc.feedFrame(1, 8000, mono([1, 2, 3, 4, 5]))
    expect(result!.byteLength).toBe(5)
  })

  it("dispose does not throw", () => {
    const enc = g711ChunkedEncoderDefinition.create({ variant: "alaw" })
    enc.feedFrame(1, 8000, mono([100]))
    expect(() => enc.dispose()).not.toThrow()
  })
})

describe("G.711 ChunkedEncoder (U-law)", () => {
  it("encodes mono frame with U-law variant", () => {
    const enc = g711ChunkedEncoderDefinition.create({ variant: "ulaw" })
    const result = enc.feedFrame(1, 8000, mono([0, 1000, -1000]))

    expect(result).not.toBeNull()
    expect(result!.byteLength).toBe(3)
  })

  it("A-law and U-law produce different encodings for the same input", () => {
    const alaw = g711ChunkedEncoderDefinition
      .create({ variant: "alaw" })
      .feedFrame(1, 8000, mono([1000, -500, 200]))
    const ulaw = g711ChunkedEncoderDefinition
      .create({ variant: "ulaw" })
      .feedFrame(1, 8000, mono([1000, -500, 200]))

    // A-law 和 U-law 是不同算法，输出应不同
    expect(Array.from(alaw!)).not.toEqual(Array.from(ulaw!))
  })

  it("defaults to A-law when variant is not specified", () => {
    const defaultEnc = g711ChunkedEncoderDefinition.create()
    const alawEnc = g711ChunkedEncoderDefinition.create({ variant: "alaw" })

    const defaultResult = defaultEnc.feedFrame(1, 8000, mono([1000, -500]))
    const alawResult = alawEnc.feedFrame(1, 8000, mono([1000, -500]))

    expect(Array.from(defaultResult!)).toEqual(Array.from(alawResult!))
  })
})
