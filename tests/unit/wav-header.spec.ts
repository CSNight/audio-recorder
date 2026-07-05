import { describe, expect, it } from "vitest"
import { createWavHeader } from "../../src/codecs/base/wav-header"

describe("createWavHeader", () => {
  it("produces a 44-byte buffer", () => {
    const header = createWavHeader({
      dataBytes: 0,
      sampleRate: 44100,
      channels: 1,
      bitRate: 16,
    })
    expect(header.byteLength).toBe(44)
  })

  it("writes RIFF and WAVE markers", () => {
    const header = createWavHeader({
      dataBytes: 0,
      sampleRate: 44100,
      channels: 1,
      bitRate: 16,
    })
    const view = new DataView(header)
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    )
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    )
    expect(riff).toBe("RIFF")
    expect(wave).toBe("WAVE")
  })

  it("sets chunk size to 36 + dataBytes", () => {
    const dataBytes = 1000
    const header = createWavHeader({
      dataBytes,
      sampleRate: 44100,
      channels: 1,
      bitRate: 16,
    })
    const view = new DataView(header)
    expect(view.getUint32(4, true)).toBe(36 + dataBytes)
  })

  it("sets correct sample rate", () => {
    const header = createWavHeader({
      dataBytes: 0,
      sampleRate: 22050,
      channels: 1,
      bitRate: 16,
    })
    const view = new DataView(header)
    expect(view.getUint32(24, true)).toBe(22050)
  })

  it("sets correct channel count", () => {
    const header = createWavHeader({
      dataBytes: 0,
      sampleRate: 44100,
      channels: 2,
      bitRate: 16,
    })
    const view = new DataView(header)
    expect(view.getUint16(22, true)).toBe(2)
  })

  it("sets correct bit depth", () => {
    const header8 = createWavHeader({
      dataBytes: 0,
      sampleRate: 44100,
      channels: 1,
      bitRate: 8,
    })
    const header16 = createWavHeader({
      dataBytes: 0,
      sampleRate: 44100,
      channels: 1,
      bitRate: 16,
    })
    const view8 = new DataView(header8)
    const view16 = new DataView(header16)
    expect(view8.getUint16(34, true)).toBe(8)
    expect(view16.getUint16(34, true)).toBe(16)
  })

  it("computes byteRate = sampleRate * channels * (bitRate/8)", () => {
    const header = createWavHeader({
      dataBytes: 0,
      sampleRate: 44100,
      channels: 2,
      bitRate: 16,
    })
    const view = new DataView(header)
    expect(view.getUint32(28, true)).toBe(44100 * 2 * 2)
  })

  it("computes blockAlign = channels * (bitRate/8)", () => {
    const header = createWavHeader({
      dataBytes: 0,
      sampleRate: 44100,
      channels: 2,
      bitRate: 16,
    })
    const view = new DataView(header)
    expect(view.getUint16(32, true)).toBe(2 * 2)
  })

  it("writes data chunk size at offset 40", () => {
    const header = createWavHeader({
      dataBytes: 512,
      sampleRate: 44100,
      channels: 1,
      bitRate: 16,
    })
    const view = new DataView(header)
    expect(view.getUint32(40, true)).toBe(512)
  })

  it("audio format is PCM (1)", () => {
    const header = createWavHeader({
      dataBytes: 0,
      sampleRate: 44100,
      channels: 1,
      bitRate: 16,
    })
    const view = new DataView(header)
    expect(view.getUint16(20, true)).toBe(1)
  })
})
