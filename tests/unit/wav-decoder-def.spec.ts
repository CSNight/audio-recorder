import { describe, expect, it } from "vitest"
import { decodeWavToFloat32 } from "../../src/codecs/base/wav-decoder"
import { createWavHeader } from "../../src/codecs/base/wav-header"

function makeWavBuffer(
  samples: Int16Array,
  sampleRate = 44100,
  channels = 1
): ArrayBuffer {
  const header = createWavHeader({
    dataBytes: samples.byteLength,
    sampleRate,
    channels,
    bitRate: 16,
  })
  const combined = new Uint8Array(header.byteLength + samples.byteLength)
  combined.set(new Uint8Array(header), 0)
  combined.set(new Uint8Array(samples.buffer), header.byteLength)
  return combined.buffer
}

describe("decodeWavToFloat32", () => {
  it("decodes mono 16-bit WAV correctly", () => {
    const samples = new Int16Array([0, 16384, -16384, 32767])
    const buf = makeWavBuffer(samples, 44100, 1)
    const result = decodeWavToFloat32(buf)
    expect(result.sampleRate).toBe(44100)
    expect(result.channels).toBe(1)
    expect(result.bitRate).toBe(16)
    expect(result.planar).toHaveLength(1)
    expect(result.planar[0]!.length).toBe(4)
    expect(result.planar[0]![0]).toBeCloseTo(0, 5)
    expect(result.planar[0]![1]).toBeCloseTo(0.5, 2)
    expect(result.planar[0]![2]).toBeCloseTo(-0.5, 2)
  })

  it("decodes stereo 16-bit WAV correctly", () => {
    // interleaved: L0, R0
    const samples = new Int16Array([16384, -16384])
    const buf = makeWavBuffer(samples, 16000, 2)
    const result = decodeWavToFloat32(buf)
    expect(result.channels).toBe(2)
    expect(result.planar[0]![0]).toBeCloseTo(0.5, 2)
    expect(result.planar[1]![0]).toBeCloseTo(-0.5, 2)
  })

  it("throws on buffer too small", () => {
    expect(() => decodeWavToFloat32(new ArrayBuffer(10))).toThrow("too small")
  })

  it("throws on invalid RIFF/WAVE header", () => {
    const buf = new ArrayBuffer(44)
    expect(() => decodeWavToFloat32(buf)).toThrow("Invalid WAV header")
  })

  it("throws when fmt chunk is missing", () => {
    // Build a minimal RIFF/WAVE header with no chunks
    const buf = new Uint8Array(44)
    const view = new DataView(buf.buffer)
    // Write "RIFF"
    ;[0x52, 0x49, 0x46, 0x46].forEach((b, i) => view.setUint8(i, b))
    view.setUint32(4, 36, true)
    // Write "WAVE"
    ;[0x57, 0x41, 0x56, 0x45].forEach((b, i) => view.setUint8(8 + i, b))
    expect(() => decodeWavToFloat32(buf.buffer)).toThrow("fmt chunk is missing")
  })
})
