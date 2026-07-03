import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "../../src/buffer/types"
import { exportWavSnapshot } from "../../src/codecs/base/wav-exporter"

function readAscii(view: DataView, offset: number, length: number): string {
  return Array.from({ length }, (_, index) =>
    String.fromCharCode(view.getUint8(offset + index))
  ).join("")
}

describe("exportWavSnapshot", () => {
  it("exports mono 16-bit PCM as a WAV buffer with a valid header", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 1,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([0, 1000, -1000, 500])],
    }

    const result = exportWavSnapshot(snapshot)
    const view = new DataView(result.arrayBuffer)

    expect(result.mimeType).toBe("audio/wav")
    expect(result.bitRate).toBe(16)
    expect(result.blob.type).toBe("audio/wav")
    expect(readAscii(view, 0, 4)).toBe("RIFF")
    expect(readAscii(view, 8, 4)).toBe("WAVE")
    expect(readAscii(view, 12, 4)).toBe("fmt ")
    expect(readAscii(view, 36, 4)).toBe("data")
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(8)
    expect(result.arrayBuffer.byteLength).toBe(52)
  })

  it("exports stereo 8-bit WAV data and converts payload to unsigned bytes", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 48_000,
      channels: 2,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([-32768, 0]), new Int16Array([32767, 256])],
    }

    const result = exportWavSnapshot(snapshot, { bitRate: 8 })
    const payload = Array.from(new Uint8Array(result.arrayBuffer.slice(44)))

    expect(result.bitRate).toBe(8)
    expect(payload).toEqual([0, 255, 128, 129])
  })

  it("supports resampled WAV export", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 48_000,
      channels: 1,
      frameCount: 1,
      durationMs: 0.125,
      planar: [new Int16Array([0, 256, 512, 768, 1024, 1280])],
    }

    const result = exportWavSnapshot(snapshot, {
      sampleRate: 16_000,
      bitRate: 16,
    })
    const view = new DataView(result.arrayBuffer)

    expect(result.sampleRate).toBe(16_000)
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint32(40, true)).toBe(4)
  })
})
