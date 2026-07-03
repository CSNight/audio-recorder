import { afterEach, describe, expect, it, vi } from "vitest"
import type { PcmBufferSnapshot } from "../../src/buffer/types"

function makeSnapshot(sampleRate = 48000, channels = 1): PcmBufferSnapshot {
  const samplesPerChannel = 320
  const planar = Array.from({ length: channels }, () => {
    const channel = new Int16Array(samplesPerChannel)
    for (let i = 0; i < samplesPerChannel; i += 1) channel[i] = i
    return channel
  })

  return {
    sampleRate,
    channels,
    frameCount: 1,
    durationMs: (samplesPerChannel / sampleRate) * 1000,
    planar,
  }
}

function createResampledSnapshot(
  snapshot: PcmBufferSnapshot,
  targetSampleRate: number
): PcmBufferSnapshot {
  return {
    ...snapshot,
    sampleRate: targetSampleRate,
    durationMs: ((snapshot.planar[0]?.length ?? 0) / targetSampleRate) * 1000,
    planar: snapshot.planar.map((channel) => new Int16Array(channel)),
  }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("exporter HQ resample forwarding", () => {
  it("passes isHQ to PCM export", async () => {
    const snapshot = makeSnapshot()
    const resample = vi.fn(
      (value: PcmBufferSnapshot, targetSampleRate: number) =>
        createResampledSnapshot(value, targetSampleRate)
    )
    vi.doMock("@csnight/audio-recorder", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@csnight/audio-recorder")>()
      return { ...actual, resample }
    })

    const { exportPcmSnapshot } =
      await import("../../src/codecs/base/pcm-exporter")
    exportPcmSnapshot(snapshot, { sampleRate: 16000, isHQ: true })

    expect(resample).toHaveBeenCalledWith(snapshot, 16000, { isHQ: true })
  })

  it("passes isHQ to G.711 export", async () => {
    const snapshot = makeSnapshot()
    const resample = vi.fn(
      (value: PcmBufferSnapshot, targetSampleRate: number) =>
        createResampledSnapshot(value, targetSampleRate)
    )
    vi.doMock("@csnight/audio-recorder", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@csnight/audio-recorder")>()
      return { ...actual, resample }
    })

    const { exportG711Snapshot } =
      await import("../../src/codecs/g711/g711-snapshot-exporter")
    exportG711Snapshot(snapshot, { sampleRate: 8000, isHQ: true })

    expect(resample).toHaveBeenCalledWith(snapshot, 8000, { isHQ: true })
  })

  it("passes isHQ to AAC export", async () => {
    const snapshot = makeSnapshot()
    const resample = vi.fn(
      (value: PcmBufferSnapshot, targetSampleRate: number) =>
        createResampledSnapshot(value, targetSampleRate)
    )
    vi.doMock("@csnight/audio-recorder", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@csnight/audio-recorder")>()
      return { ...actual, resample }
    })
    vi.doMock("../../src/codecs/aac/aac-wasm-api", () => ({
      preloadAacModule: vi.fn(),
      isSupportSampleRate: vi.fn(() => true),
      createAacEncoder: vi.fn(() => ({
        sampleRate: 44100,
        channels: 1,
        bitrate: 128000,
        frameSize: 1024,
        audioSpecificConfig: new Uint8Array([0x12, 0x10]),
        encode: vi.fn(() => []),
        flush: vi.fn(() => []),
        free: vi.fn(),
      })),
    }))

    const { exportAacSnapshot } =
      await import("../../src/codecs/aac/aac-snapshot-exporter")
    exportAacSnapshot(snapshot, { sampleRate: 44100, isHQ: true })

    expect(resample).toHaveBeenCalledWith(snapshot, 44100, { isHQ: true })
  })

  it("passes isHQ to MP3 export", async () => {
    const snapshot = makeSnapshot()
    const resample = vi.fn(
      (value: PcmBufferSnapshot, targetSampleRate: number) =>
        createResampledSnapshot(value, targetSampleRate)
    )
    vi.doMock("@csnight/audio-recorder", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@csnight/audio-recorder")>()
      return { ...actual, resample }
    })
    vi.doMock("../../src/codecs/mp3/mp3-wasm-api", () => ({
      preloadMp3Module: vi.fn(),
      resolveMp3EncoderOptions: vi.fn(
        (options: Record<string, unknown>, sampleRate: number) => ({
          bitrateKbps: 128,
          mode: "cbr",
          vbrQuality: 4,
          sampleRate: (options.sampleRate as number | undefined) ?? sampleRate,
          channelMode: "mono",
          quality: 2,
        })
      ),
      createMp3Encoder: vi.fn(() => ({
        sampleRate: 16000,
        channels: 1,
        encode: vi.fn(() => new Uint8Array(0)),
        flush: vi.fn(() => new Uint8Array(0)),
        free: vi.fn(),
      })),
    }))

    const { exportMp3Snapshot } =
      await import("../../src/codecs/mp3/mp3-snapshot-exporter")
    exportMp3Snapshot(snapshot, { sampleRate: 16000, isHQ: true })

    expect(resample).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 48000 }),
      16000,
      { isHQ: true }
    )
  })

  it("passes isHQ to FLAC export", async () => {
    const snapshot = makeSnapshot()
    const resample = vi.fn(
      (value: PcmBufferSnapshot, targetSampleRate: number) =>
        createResampledSnapshot(value, targetSampleRate)
    )
    vi.doMock("@csnight/audio-recorder", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@csnight/audio-recorder")>()
      return { ...actual, resample }
    })
    vi.doMock("../../src/codecs/flac/flac-wasm-api", () => ({
      preloadFlacModule: vi.fn(),
      createFlacEncoder: vi.fn(() => ({
        sampleRate: 44100,
        channels: 1,
        bitsPerSample: 16,
        encode: vi.fn(() => new Uint8Array(0)),
        flush: vi.fn(() => new Uint8Array(0)),
        free: vi.fn(),
      })),
    }))

    const { exportFlacSnapshot } =
      await import("../../src/codecs/flac/flac-snapshot-exporter")
    exportFlacSnapshot(snapshot, { sampleRate: 44100, isHQ: true })

    expect(resample).toHaveBeenCalledWith(snapshot, 44100, { isHQ: true })
  })

  it("passes isHQ to Opus export", async () => {
    const snapshot = makeSnapshot()
    const resample = vi.fn(
      (value: PcmBufferSnapshot, targetSampleRate: number) =>
        createResampledSnapshot(value, targetSampleRate)
    )
    vi.doMock("@csnight/audio-recorder", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@csnight/audio-recorder")>()
      return { ...actual, resample }
    })
    vi.doMock("../../src/codecs/opus/opus-wasm-api", () => ({
      preloadOpusModule: vi.fn(),
      createOpusEncoder: vi.fn(() => ({
        sampleRate: 16000,
        channels: 1,
        frameSize: 320,
        getLookahead: vi.fn(() => 0),
        encode: vi.fn(() => new Uint8Array([1, 2, 3])),
        encodeFloat: vi.fn(() => new Uint8Array([1, 2, 3])),
        free: vi.fn(),
      })),
    }))

    const { exportOpusSnapshot } =
      await import("../../src/codecs/opus/opus-snapshot-exporter")
    exportOpusSnapshot(snapshot, { sampleRate: 16000, isHQ: true })

    expect(resample).toHaveBeenCalledWith(snapshot, 16000, { isHQ: true })
  })

  it("passes isHQ to AMR export", async () => {
    const snapshot = makeSnapshot()
    const resample = vi.fn(
      (value: PcmBufferSnapshot, targetSampleRate: number) =>
        createResampledSnapshot(value, targetSampleRate)
    )
    vi.doMock("@csnight/audio-recorder", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@csnight/audio-recorder")>()
      return { ...actual, resample }
    })
    vi.doMock("../../src/codecs/amr/amr-wasm-api", () => ({
      preloadAmrModules: vi.fn(),
      getAmrMimeType: vi.fn(() => "audio/amr"),
      getAmrStreamHeader: vi.fn(() => new Uint8Array([35])),
      getAmrTargetSampleRate: vi.fn(() => 8000),
      createAmrEncoder: vi.fn(() => ({
        bandMode: "nb",
        sampleRate: 8000,
        frameSize: 160,
        encode: vi.fn(() => new Uint8Array([1])),
        free: vi.fn(),
      })),
    }))

    const { exportAmrSnapshot } =
      await import("../../src/codecs/amr/amr-snapshot-exporter")
    exportAmrSnapshot(snapshot, { bandMode: "nb", isHQ: true })

    expect(resample).toHaveBeenCalledWith(snapshot, 8000, { isHQ: true })
  })

  it("passes isHQ to AC3 export", async () => {
    const snapshot = makeSnapshot()
    const resample = vi.fn(
      (value: PcmBufferSnapshot, targetSampleRate: number) =>
        createResampledSnapshot(value, targetSampleRate)
    )
    vi.doMock("@csnight/audio-recorder", async (importOriginal) => {
      const actual =
        await importOriginal<typeof import("@csnight/audio-recorder")>()
      return { ...actual, resample }
    })
    vi.doMock("../../src/codecs/ac3/ac3-wasm-api", () => ({
      preloadAc3Module: vi.fn(),
      resolveAc3EncoderOptions: vi.fn(
        (
          options: Record<string, unknown>,
          sampleRate: number,
          channels: number
        ) => ({
          codec: (options.codec as "ac3" | "eac3" | undefined) ?? "ac3",
          sampleRate: (options.sampleRate as number | undefined) ?? sampleRate,
          channels,
          bitrate: 384000,
        })
      ),
      createAc3Encoder: vi.fn(() => ({
        codec: "ac3",
        sampleRate: 44100,
        channels: 1,
        bitrate: 384000,
        frameSize: 256,
        encode: vi.fn(() => []),
        flush: vi.fn(() => []),
        free: vi.fn(),
      })),
    }))

    const { exportAc3Snapshot } =
      await import("../../src/codecs/ac3/ac3-snapshot-exporter")
    exportAc3Snapshot(snapshot, { sampleRate: 44100, isHQ: true })

    expect(resample).toHaveBeenCalledWith(snapshot, 44100, { isHQ: true })
  })
})
