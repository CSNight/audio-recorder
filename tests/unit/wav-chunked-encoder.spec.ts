import { describe, expect, it } from "vitest"
import { wavStreamEncoder } from "@/codecs/base/wav-chunked-encoder"

function mono(samples: number[]): Int16Array[] {
  return [new Int16Array(samples)]
}

function stereo(left: number[], right: number[]): Int16Array[] {
  return [new Int16Array(left), new Int16Array(right)]
}

const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] // "RIFF"
const WAVE_MAGIC = [0x57, 0x41, 0x56, 0x45] // "WAVE"

function verifyWavHeader(
  buf: Uint8Array,
  channels: number,
  sampleRate: number,
  dataBytes: number
) {
  // Magic
  expect(Array.from(buf.subarray(0, 4))).toEqual(RIFF_MAGIC)
  expect(Array.from(buf.subarray(8, 12))).toEqual(WAVE_MAGIC)

  const view = new DataView(buf.buffer, buf.byteOffset)
  expect(view.getUint32(4, true)).toBe(36 + dataBytes) // RIFF chunk size
  expect(view.getUint16(20, true)).toBe(1) // PCM format
  expect(view.getUint16(22, true)).toBe(channels)
  expect(view.getUint32(24, true)).toBe(sampleRate)
  expect(view.getUint32(40, true)).toBe(dataBytes) // data chunk size
}

describe("WAV ChunkedEncoder", () => {
  it("returns null while buffer is below framesPerChunk threshold", () => {
    const enc = wavStreamEncoder.create({ framesPerChunk: 3 })
    expect(enc.feedFrame(1, 16000, mono([1, 2, 3]))).toBeNull()
    expect(enc.feedFrame(1, 16000, mono([4, 5, 6]))).toBeNull()
  })

  it("emits a complete WAV chunk once framesPerChunk is reached", () => {
    const enc = wavStreamEncoder.create({ framesPerChunk: 2 })
    expect(enc.feedFrame(1, 16000, mono([1, 2]))).toBeNull()

    const result = enc.feedFrame(1, 16000, mono([3, 4]))
    expect(result).not.toBeNull()
    // 4 samples × 2 bytes = 8 bytes of PCM data
    verifyWavHeader(result!, 1, 16000, 8)
    expect(result!.byteLength).toBe(44 + 8)
  })

  it("flush emits remaining buffered frames as final chunk", () => {
    const enc = wavStreamEncoder.create({ framesPerChunk: 10 })
    enc.feedFrame(1, 16000, mono([100, 200]))
    enc.feedFrame(1, 16000, mono([300]))

    const result = enc.flush()
    expect(result).not.toBeNull()
    // 3 samples × 2 bytes = 6 bytes
    verifyWavHeader(result!, 1, 16000, 6)
    expect(result!.byteLength).toBe(50)
  })

  it("flush returns null when buffer is empty", () => {
    const enc = wavStreamEncoder.create({ framesPerChunk: 2 })
    enc.feedFrame(1, 16000, mono([1]))
    enc.feedFrame(1, 16000, mono([2])) // triggers chunk emit
    // buffer now empty
    expect(enc.flush()).toBeNull()
  })

  it("handles stereo interleaving correctly in WAV output", () => {
    const enc = wavStreamEncoder.create({ framesPerChunk: 1 })
    const result = enc.feedFrame(2, 44100, stereo([100], [200]))

    expect(result).not.toBeNull()
    // 1 sample × 2 channels × 2 bytes = 4 bytes
    verifyWavHeader(result!, 2, 44100, 4)
    const view = new DataView(result!.buffer, result!.byteOffset)
    expect(view.getInt16(44, true)).toBe(100) // L
    expect(view.getInt16(46, true)).toBe(200) // R
  })

  it("reuses the left channel when stereo input omits the right channel", () => {
    const enc = wavStreamEncoder.create({ framesPerChunk: 1 })
    const result = enc.feedFrame(2, 44100, [new Int16Array([100, -200])])

    expect(result).not.toBeNull()
    const view = new DataView(result!.buffer, result!.byteOffset)
    expect(view.getInt16(44, true)).toBe(100)
    expect(view.getInt16(46, true)).toBe(100)
    expect(view.getInt16(48, true)).toBe(-200)
    expect(view.getInt16(50, true)).toBe(-200)
  })

  it("supports multi-channel audio (3+ channels)", () => {
    const enc = wavStreamEncoder.create({ framesPerChunk: 1 })

    const result = enc.feedFrame(3, 16000, [
      new Int16Array([100]),
      new Int16Array([200]),
      new Int16Array([300]),
    ])

    expect(result).not.toBeNull()
    // 验证 WAV header 中的声道数
    const view = new DataView(result!.buffer, result!.byteOffset)
    expect(view.getUint16(22, true)).toBe(3) // channels field in WAV header
    // 验证交织的 PCM 数据（偏移44是 data chunk 开始）
    expect(view.getInt16(44, true)).toBe(100) // ch0
    expect(view.getInt16(46, true)).toBe(200) // ch1
    expect(view.getInt16(48, true)).toBe(300) // ch2
  })

  it("dispose clears buffer so flush returns null", () => {
    const enc = wavStreamEncoder.create({ framesPerChunk: 5 })
    enc.feedFrame(1, 16000, mono([1, 2, 3]))
    enc.dispose()
    expect(enc.flush()).toBeNull()
  })
})
