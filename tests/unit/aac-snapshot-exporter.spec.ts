import { beforeAll, describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import {
  aacSnapshotEncoderDefinition,
  exportAacSnapshot,
} from "@/codecs/aac/aac-snapshot-exporter"
import { preloadAacModule } from "@/codecs/aac/aac-wasm-api"

function sine(length: number, freq = 440, sampleRate = 48000): Int16Array {
  const out = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 16000)
  }
  return out
}

function makeSnapshot(
  samplesPerChannel: number,
  channels = 1,
  sampleRate = 48000
): PcmBufferSnapshot {
  const planar: Int16Array[] = []
  for (let channel = 0; channel < channels; channel++) {
    planar.push(sine(samplesPerChannel, 440 + channel * 110, sampleRate))
  }

  return {
    sampleRate,
    channels,
    frameCount: 1,
    durationMs: (samplesPerChannel / sampleRate) * 1000,
    planar,
  }
}

describe("aacSnapshotEncoderDefinition", () => {
  beforeAll(async () => {
    await preloadAacModule()
  })

  it("has type 'aac'", () => {
    expect(aacSnapshotEncoderDefinition.type).toBe("aac")
  })

  it("exports ADTS AAC data with default metadata", () => {
    const snapshot = makeSnapshot(48000, 1, 48000)
    const result = exportAacSnapshot(snapshot)

    expect(result.mimeType).toBe("audio/aac")
    expect(result.sampleRate).toBe(48000)
    expect(result.channels).toBe(1)
    expect(result.bitrate).toBe(128000)
    expect(result.data.byteLength).toBeGreaterThan(0)
    expect(result.data[0]).toBe(0xff)
    expect((result.data[1]! & 0xf0) === 0xf0).toBe(true)
  })

  it("clamps default bitrate for low sample-rate mono export", () => {
    const snapshot = makeSnapshot(16000, 1, 16000)
    const result = exportAacSnapshot(snapshot)

    expect(result.sampleRate).toBe(16000)
    expect(result.channels).toBe(1)
    expect(result.bitrate).toBe(96000)
    expect(result.data.byteLength).toBeGreaterThan(0)
    expect(result.data[0]).toBe(0xff)
  })

  it("resamples to the requested sampleRate before encoding", () => {
    const snapshot = makeSnapshot(48000, 1, 48000)
    const result = exportAacSnapshot(snapshot, { sampleRate: 44100 })

    expect(result.sampleRate).toBe(44100)
    expect(result.data.byteLength).toBeGreaterThan(0)
  })

  it("supports stereo export", () => {
    const snapshot = makeSnapshot(48000, 2, 48000)
    const result = exportAacSnapshot(snapshot, { bitrate: 192000 })

    expect(result.channels).toBe(2)
    expect(result.bitrate).toBe(192000)
    expect(result.data.byteLength).toBeGreaterThan(0)
  })
})
