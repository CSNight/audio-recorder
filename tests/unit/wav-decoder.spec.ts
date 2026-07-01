import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import { wavDecoderDefinition } from "@/codecs/base"
import { exportWavSnapshot } from "@/codecs/base/wav-exporter"

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
      channels: 1
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
      channels: 2
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
      channels: 2
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
        channels: 1
      })
    ).rejects.toThrow("Invalid WAV header.")
  })
})
