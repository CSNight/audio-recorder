import { describe, expect, it } from "vitest"
import { pcmChunkedEncoderDefinition } from "@/codecs/base/pcm-chunked-encoder"

/** 构造 planar Int16Array 数组 */
function mono(samples: number[]): Int16Array[] {
  return [new Int16Array(samples)]
}

function stereo(left: number[], right: number[]): Int16Array[] {
  return [new Int16Array(left), new Int16Array(right)]
}

describe("PCM ChunkedEncoder", () => {
  it("outputs interleaved 16-bit mono PCM immediately", () => {
    const enc = pcmChunkedEncoderDefinition.create()
    const result = enc.feedFrame(1, 16000, mono([0, 1000, -1000]))

    expect(result).not.toBeNull()
    const view = new DataView(result!.buffer)
    expect(view.getInt16(0, true)).toBe(0)
    expect(view.getInt16(2, true)).toBe(1000)
    expect(view.getInt16(4, true)).toBe(-1000)
  })

  it("outputs interleaved 16-bit stereo PCM (L0, R0, L1, R1, ...)", () => {
    const enc = pcmChunkedEncoderDefinition.create()
    const result = enc.feedFrame(2, 16000, stereo([100, 200], [300, 400]))

    expect(result).not.toBeNull()
    const view = new DataView(result!.buffer)
    expect(view.getInt16(0, true)).toBe(100) // L0
    expect(view.getInt16(2, true)).toBe(300) // R0
    expect(view.getInt16(4, true)).toBe(200) // L1
    expect(view.getInt16(6, true)).toBe(400) // R1
  })

  it("outputs 8-bit unsigned PCM when bitsPerSample is 8", () => {
    const enc = pcmChunkedEncoderDefinition.create({ bitsPerSample: 8 })
    // Int16 32767 >> 8 = 127, + 128 = 255
    const result = enc.feedFrame(1, 16000, mono([32767, 0, -32768]))

    expect(result).not.toBeNull()
    expect(result!.byteLength).toBe(3)
    expect(result![0]).toBe(255) // 127 + 128
    expect(result![1]).toBe(128) // 0 + 128
    expect(result![2]).toBe(0) // -128 + 128
  })

  it("reuses the left channel when stereo input omits the right channel in 16-bit mode", () => {
    const enc = pcmChunkedEncoderDefinition.create()
    const result = enc.feedFrame(2, 16000, [new Int16Array([100, -200])])

    expect(result).not.toBeNull()
    const view = new DataView(result!.buffer)
    expect(view.getInt16(0, true)).toBe(100)
    expect(view.getInt16(2, true)).toBe(100)
    expect(view.getInt16(4, true)).toBe(-200)
    expect(view.getInt16(6, true)).toBe(-200)
  })

  it("outputs 8-bit stereo PCM and falls back to the left channel when the right channel is missing", () => {
    const enc = pcmChunkedEncoderDefinition.create({ bitsPerSample: 8 })
    const result = enc.feedFrame(2, 16000, [new Int16Array([32767, -32768])])

    expect(result).not.toBeNull()
    expect(Array.from(result!)).toEqual([255, 255, 0, 0])
  })

  it("supports 3-channel 16-bit interleaving and fills missing channels with silence", () => {
    const enc = pcmChunkedEncoderDefinition.create()
    const result = enc.feedFrame(3, 16000, [
      new Int16Array([100, 200]),
      new Int16Array([-100, -200]),
    ])

    expect(result).not.toBeNull()
    const view = new DataView(result!.buffer)
    expect(view.getInt16(0, true)).toBe(100)
    expect(view.getInt16(2, true)).toBe(-100)
    expect(view.getInt16(4, true)).toBe(0)
    expect(view.getInt16(6, true)).toBe(200)
    expect(view.getInt16(8, true)).toBe(-200)
    expect(view.getInt16(10, true)).toBe(0)
  })

  it("supports 3-channel 8-bit interleaving and fills missing channels with silence", () => {
    const enc = pcmChunkedEncoderDefinition.create({ bitsPerSample: 8 })
    const result = enc.feedFrame(3, 16000, [
      new Int16Array([32767]),
      new Int16Array([-32768]),
    ])

    expect(result).not.toBeNull()
    expect(Array.from(result!)).toEqual([255, 0, 128])
  })

  it("returns null for empty frame", () => {
    const enc = pcmChunkedEncoderDefinition.create()
    expect(enc.feedFrame(1, 16000, [new Int16Array(0)])).toBeNull()
    expect(enc.feedFrame(1, 16000, [])).toBeNull()
  })

  it("flush always returns null (no internal buffer)", () => {
    const enc = pcmChunkedEncoderDefinition.create()
    enc.feedFrame(1, 16000, mono([1, 2, 3]))
    expect(enc.flush()).toBeNull()
  })
})
