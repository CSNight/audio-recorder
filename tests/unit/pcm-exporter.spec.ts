import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "../../src"
import { exportPcmSnapshot } from "../../src/codecs/base/pcm-exporter"

describe("exportPcmSnapshot", () => {
  it("exports mono PCM as interleaved Uint8Array (16-bit) by default", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 1,
      frameCount: 2,
      durationMs: 0.5,
      planar: [new Int16Array([0, 1000, -1000, 500])],
    }

    const result = exportPcmSnapshot(snapshot)

    expect(result.sampleRate).toBe(16_000)
    expect(result.channels).toBe(1)
    expect(result.bitRate).toBe(16)
    expect(result.data).toBeInstanceOf(Uint8Array)
    // 16-bit little-endian: verify by reading back as Int16Array
    const i16 = new Int16Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength / 2
    )
    expect(Array.from(i16)).toEqual([0, 1000, -1000, 500])
  })

  it("exports stereo PCM as interleaved Uint8Array (16-bit)", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 48_000,
      channels: 2,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([1000, 2000]), new Int16Array([-1000, -2000])],
    }

    const result = exportPcmSnapshot(snapshot)

    const i16 = new Int16Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength / 2
    )
    expect(Array.from(i16)).toEqual([1000, -1000, 2000, -2000])
  })

  it("supports exporting 8-bit PCM and resampled output", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 48_000,
      channels: 1,
      frameCount: 1,
      durationMs: 0.125,
      planar: [new Int16Array([0, 256, 512, 768, 1024, 1280])],
    }

    const result = exportPcmSnapshot(snapshot, {
      sampleRate: 16_000,
      bitRate: 8,
    })

    expect(result.sampleRate).toBe(16_000)
    expect(result.bitRate).toBe(8)
    expect(result.data).toBeInstanceOf(Uint8Array)
    // 8-bit: each byte is a signed Int8 value stored as 2's complement in Uint8Array
    const i8 = new Int8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength
    )
    expect(Array.from(i8)).toEqual([0, 3])
  })

  it("rejects unsupported PCM export bitRate values", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 1,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([0, 1000])],
    }

    expect(() =>
      exportPcmSnapshot(snapshot, {
        bitRate: 12 as 8 | 16,
      })
    ).toThrow("PCM export bitRate 12 is not supported.")
  })

  it("reuses the left channel when stereo snapshot has incomplete planar data", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 2,
      frameCount: 2,
      durationMs: 0.5,
      planar: [new Int16Array([1000, -1000])],
    }

    const result = exportPcmSnapshot(snapshot)

    // 单声道升混到双声道：复用第一声道
    const i16 = new Int16Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength / 2
    )
    expect(Array.from(i16)).toEqual([1000, 1000, -1000, -1000])
  })

  it("supports generic multi-channel interleaving and fills missing channels with silence", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 3,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([100, 200]), new Int16Array([-100, -200])],
    }

    const result = exportPcmSnapshot(snapshot)

    const i16 = new Int16Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength / 2
    )
    expect(Array.from(i16)).toEqual([100, -100, 0, 200, -200, 0])
  })

  it("supports 8-bit multi-channel export and fills missing channels with silence", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 16_000,
      channels: 3,
      frameCount: 1,
      durationMs: 0.25,
      planar: [new Int16Array([32767]), new Int16Array([-32768])],
    }

    const result = exportPcmSnapshot(snapshot, { bitRate: 8 })

    expect(result.data).toBeInstanceOf(Uint8Array)
    const i8 = new Int8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength
    )
    expect(Array.from(i8)).toEqual([127, -128, 0])
  })
})
