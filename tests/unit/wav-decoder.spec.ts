import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "../../src/buffer/types"
import { wavDecoderDefinition } from "../../src/codecs/base"
import { exportWavSnapshot } from "../../src/codecs/base/wav-exporter"

describe("wavDecoderDefinition", () => {
  it("decodes mono 16-bit WAV payload into planar float32 data", async () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16000,
      channels: 1,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([0, 16384, -16384, 8192])],
    }

    const wav = exportWavSnapshot(snapshot)
    const decoded = await wavDecoderDefinition.decode({
      chunk: new Uint8Array(wav.arrayBuffer),
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    })

    expect(decoded.sampleRate).toBe(16000)
    expect(decoded.channels).toBe(1)
    expect(Array.from(decoded.planar[0] ?? [])).toEqual([0, 0.5, -0.5, 0.25])
  })

  it("decodes stereo 8-bit WAV payload into per-channel planar data", async () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 8000,
      channels: 2,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([-32768, 0]), new Int16Array([32767, 256])],
    }

    const wav = exportWavSnapshot(snapshot, { bitRate: 8 })
    const decoded = await wavDecoderDefinition.decode({
      chunk: new Uint8Array(wav.arrayBuffer),
      format: "wav",
      sampleRate: 8000,
      channels: 2,
    })

    expect(decoded.sampleRate).toBe(8000)
    expect(decoded.channels).toBe(2)
    expect(Array.from(decoded.planar[0] ?? [])).toEqual([-1, 0])
    expect(Array.from(decoded.planar[1] ?? [])).toEqual([127 / 128, 1 / 128])
  })

  it("decodes stereo 16-bit WAV payload into per-channel planar data", async () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 48000,
      channels: 2,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([0, 8192]), new Int16Array([-16384, 16384])],
    }

    const wav = exportWavSnapshot(snapshot)
    const decoded = await wavDecoderDefinition.decode({
      chunk: new Uint8Array(wav.arrayBuffer),
      format: "wav",
      sampleRate: 48000,
      channels: 2,
    })

    expect(decoded.sampleRate).toBe(48000)
    expect(decoded.channels).toBe(2)
    expect(Array.from(decoded.planar[0] ?? [])).toEqual([0, 0.25])
    expect(Array.from(decoded.planar[1] ?? [])).toEqual([-0.5, 0.5])
  })

  it("throws for invalid RIFF/WAVE headers", async () => {
    const invalid = new Uint8Array(44)
    invalid.set([0x4e, 0x4f, 0x50, 0x45], 0)

    await expect(() =>
      wavDecoderDefinition.decode({
        chunk: invalid,
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      })
    ).rejects.toThrow("Invalid WAV header.")
  })

  it("throws when buffer is too small", async () => {
    const tiny = new Uint8Array(10)
    await expect(() =>
      wavDecoderDefinition.decode({
        chunk: tiny,
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      })
    ).rejects.toThrow("Invalid WAV buffer: too small.")
  })

  it("throws when fmt chunk is missing (no fmt chunk in WAV)", async () => {
    // Build a minimal WAV with only a data chunk (no fmt chunk)
    const buf = new ArrayBuffer(44)
    const view = new DataView(buf)
    // RIFF header
    const enc = new TextEncoder()
    const writeAscii = (offset: number, s: string) =>
      enc.encode(s).forEach((b, i) => view.setUint8(offset + i, b))
    writeAscii(0, "RIFF")
    view.setUint32(4, 36, true)
    writeAscii(8, "WAVE")
    // data chunk (no fmt chunk)
    writeAscii(12, "data")
    view.setUint32(16, 0, true)

    await expect(() =>
      wavDecoderDefinition.decode({
        chunk: new Uint8Array(buf),
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      })
    ).rejects.toThrow("WAV fmt chunk is missing.")
  })

  it("throws when data chunk is missing (fmt present but no data)", async () => {
    // Build WAV with fmt chunk but no data chunk
    const totalSize = 12 + 8 + 16 // RIFF header + fmt chunk header + fmt data
    const buf = new ArrayBuffer(totalSize + 44) // extra padding
    const view = new DataView(buf)
    const enc = new TextEncoder()
    const writeAscii = (offset: number, s: string) =>
      enc.encode(s).forEach((b, i) => view.setUint8(offset + i, b))
    writeAscii(0, "RIFF")
    view.setUint32(4, totalSize - 8, true)
    writeAscii(8, "WAVE")
    // fmt chunk
    writeAscii(12, "fmt ")
    view.setUint32(16, 16, true) // chunk size = 16
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // 1 channel
    view.setUint32(24, 16000, true) // sample rate
    view.setUint32(28, 32000, true) // byte rate
    view.setUint16(32, 2, true) // block align
    view.setUint16(34, 16, true) // bits per sample

    await expect(() =>
      wavDecoderDefinition.decode({
        chunk: new Uint8Array(buf),
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      })
    ).rejects.toThrow("WAV data chunk is missing.")
  })

  it("throws when data chunk size exceeds buffer length", async () => {
    // Build WAV where data chunk claims more bytes than available
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16000,
      channels: 1,
      frameCount: 1,
      durationMs: 0.125,
      planar: [new Int16Array([100, 200])],
    }
    const wav = exportWavSnapshot(snapshot)
    // Tamper: inflate the data chunk size field (bytes 40-43) to exceed buffer
    const arr = new Uint8Array(wav.arrayBuffer)
    const view = new DataView(arr.buffer)
    // Find data chunk (at offset 36 for simple WAV)
    view.setUint32(40, 999999, true) // inflate data size

    await expect(() =>
      wavDecoderDefinition.decode({
        chunk: arr,
        format: "wav",
        sampleRate: 16000,
        channels: 1,
      })
    ).rejects.toThrow("WAV data chunk exceeds buffer length.")
  })

  it("throws for non-PCM audio format", async () => {
    // Build WAV with audioFormat != 1 (e.g. 3 = IEEE float)
    const buf = new ArrayBuffer(12 + 8 + 16 + 8 + 0 + 44)
    const view = new DataView(buf)
    const enc = new TextEncoder()
    const writeAscii = (offset: number, s: string) =>
      enc.encode(s).forEach((b, i) => view.setUint8(offset + i, b))
    writeAscii(0, "RIFF")
    view.setUint32(4, buf.byteLength - 8, true)
    writeAscii(8, "WAVE")
    writeAscii(12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 3, true) // IEEE float, not PCM
    view.setUint16(22, 1, true)
    view.setUint32(24, 44100, true)
    view.setUint32(28, 88200, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeAscii(36, "data")
    view.setUint32(40, 0, true)

    await expect(() =>
      wavDecoderDefinition.decode({
        chunk: new Uint8Array(buf),
        format: "wav",
        sampleRate: 44100,
        channels: 1,
      })
    ).rejects.toThrow("Unsupported WAV format 3. Only PCM is supported.")
  })

  it("throws for unsupported fmt metadata (invalid bit rate)", async () => {
    const buf = new ArrayBuffer(12 + 8 + 16 + 8 + 0 + 44)
    const view = new DataView(buf)
    const enc = new TextEncoder()
    const writeAscii = (offset: number, s: string) =>
      enc.encode(s).forEach((b, i) => view.setUint8(offset + i, b))
    writeAscii(0, "RIFF")
    view.setUint32(4, buf.byteLength - 8, true)
    writeAscii(8, "WAVE")
    writeAscii(12, "fmt ")
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // channels
    view.setUint32(24, 44100, true)
    view.setUint32(28, 88200, true)
    view.setUint16(32, 3, true)
    view.setUint16(34, 24, true) // 24-bit — not supported (only 8/16)
    writeAscii(36, "data")
    view.setUint32(40, 0, true)

    await expect(() =>
      wavDecoderDefinition.decode({
        chunk: new Uint8Array(buf),
        format: "wav",
        sampleRate: 44100,
        channels: 1,
      })
    ).rejects.toThrow("Unsupported WAV fmt metadata.")
  })

  it("odd-sized chunk: offset advances with padding byte", async () => {
    // A WAV with an odd-sized INFO chunk before data chunk
    // This exercises: offset = chunkDataOffset + chunkSize + (chunkSize % 2)
    // chunk size 3 → padding = 1 → offset advances by 3+1=4 (even)
    const fmtSize = 16
    const infoSize = 3 // odd
    const infoSizeAligned = infoSize + (infoSize % 2) // 4
    const dataSize = 4 // 2 samples × 1ch × 2bytes
    const totalPayload =
      4 + (8 + fmtSize) + (8 + infoSizeAligned) + (8 + dataSize)
    const buf = new ArrayBuffer(8 + totalPayload)
    const view = new DataView(buf)
    const enc = new TextEncoder()
    const writeAscii = (offset: number, s: string) =>
      enc.encode(s).forEach((b, i) => view.setUint8(offset + i, b))
    writeAscii(0, "RIFF")
    view.setUint32(4, totalPayload, true)
    writeAscii(8, "WAVE")
    // fmt chunk
    let off = 12
    writeAscii(off, "fmt ")
    off += 4
    view.setUint32(off, fmtSize, true)
    off += 4
    view.setUint16(off, 1, true)
    off += 2 // PCM
    view.setUint16(off, 1, true)
    off += 2 // 1 channel
    view.setUint32(off, 16000, true)
    off += 4
    view.setUint32(off, 32000, true)
    off += 4
    view.setUint16(off, 2, true)
    off += 2
    view.setUint16(off, 16, true)
    off += 2 // 16-bit
    // INFO chunk (odd size)
    writeAscii(off, "INFO")
    off += 4
    view.setUint32(off, infoSize, true)
    off += 4
    off += infoSizeAligned // skip info data + padding
    // data chunk
    writeAscii(off, "data")
    off += 4
    view.setUint32(off, dataSize, true)
    off += 4
    view.setInt16(off, 1000, true)
    off += 2
    view.setInt16(off, -1000, true)

    const decoded = await wavDecoderDefinition.decode({
      chunk: new Uint8Array(buf),
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    })
    expect(decoded.channels).toBe(1)
    expect(decoded.sampleRate).toBe(16000)
    expect(decoded.planar[0]!.length).toBe(2)
  })
})
