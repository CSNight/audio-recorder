import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OpusEncoderHandle } from "@/codecs/opus/types"

const createOpusEncoder = vi.fn<(options: unknown) => OpusEncoderHandle>()
const preloadOpusModule = vi.fn()
const oggMuxerInstances: MockOggMuxer[] = []
const webmMuxerInstances: MockWebmMuxer[] = []

class MockOggMuxer {
  readonly options: unknown
  readonly getHeaderPages = vi.fn(() => new Uint8Array([10]))
  readonly writeFrame = vi.fn(
    (_packet: Uint8Array, granulePosition: bigint) =>
      new Uint8Array([20, Number(granulePosition)])
  )
  readonly writeFinalFrame = vi.fn(
    (_packet: Uint8Array, granulePosition: bigint) =>
      new Uint8Array([30, Number(granulePosition)])
  )

  constructor(options: unknown) {
    this.options = options
    oggMuxerInstances.push(this)
  }
}

class MockWebmMuxer {
  readonly options: unknown
  readonly getHeaders = vi.fn(() => new Uint8Array([40]))
  readonly writeFrame = vi.fn(
    (_packet: Uint8Array, timestampMs: number) =>
      new Uint8Array([50, timestampMs])
  )
  readonly finalize = vi.fn(() => new Uint8Array([60]))

  constructor(options: unknown) {
    this.options = options
    webmMuxerInstances.push(this)
  }
}

vi.mock("@/codecs/opus/opus-wasm-api", () => ({
  createOpusEncoder,
  preloadOpusModule,
}))

vi.mock("@/codecs/opus/muxers/ogg", () => ({
  OggMuxer: MockOggMuxer,
}))

vi.mock("@/codecs/opus/muxers/webm", () => ({
  WebmMuxer: MockWebmMuxer,
}))

const { oggChunkedEncoderDefinition, webmChunkedEncoderDefinition } =
  await import("@/codecs/opus/opus-chunked-encoder")

function mono(samples: number[]): Int16Array[] {
  return [new Int16Array(samples)]
}

describe("Opus chunked encoder definitions", () => {
  const encode = vi.fn()
  const free = vi.fn()
  const getLookahead = vi.fn()

  beforeEach(() => {
    createOpusEncoder.mockReset()
    preloadOpusModule.mockReset()
    encode.mockReset()
    free.mockReset()
    getLookahead.mockReset()
    oggMuxerInstances.length = 0
    webmMuxerInstances.length = 0

    getLookahead.mockReturnValue(2)
    createOpusEncoder.mockImplementation(
      (options) =>
        ({
          sampleRate: (options as { sampleRate: number }).sampleRate,
          channels: (options as { channels: number }).channels,
          frameSize: 4,
          getLookahead,
          encode,
          encodeFloat: vi.fn(),
          free,
        }) as unknown as OpusEncoderHandle
    )
  })

  it("exposes formats and preload", () => {
    expect(oggChunkedEncoderDefinition.format).toBe("ogg")
    expect(webmChunkedEncoderDefinition.format).toBe("webm")
    expect(oggChunkedEncoderDefinition.preload).toBe(preloadOpusModule)
    expect(webmChunkedEncoderDefinition.preload).toBe(preloadOpusModule)
  })

  it("creates the OGG encoder with scaled preSkip and emits headers before audio pages", () => {
    encode.mockReturnValueOnce(new Uint8Array([1, 2]))
    const encoder = oggChunkedEncoderDefinition.create({
      sampleRate: 24000,
      channels: 1,
      bitrate: 64000,
    })

    const headerOnly = encoder.feedFrame(1, 24000, mono([1, 2]))
    const chunk = encoder.feedFrame(1, 24000, mono([3, 4]))

    expect(createOpusEncoder).toHaveBeenCalledWith({
      sampleRate: 24000,
      channels: 1,
      bitrate: 64000,
      application: "audio",
      complexity: 10,
      vbr: true,
      fec: false,
      dtx: false,
      packetLossPercent: 0,
    })
    expect(oggMuxerInstances[0]?.options).toEqual({
      sampleRate: 24000,
      channels: 1,
      preSkip: 4,
    })
    expect(headerOnly).toEqual(new Uint8Array([10]))
    expect(encode).toHaveBeenCalledWith(new Int16Array([1, 2, 3, 4]))
    expect(oggMuxerInstances[0]?.writeFrame).toHaveBeenCalledWith(
      new Uint8Array([1, 2]),
      12n
    )
    expect(chunk).toEqual(new Uint8Array([20, 12]))
  })

  it("pads the final OGG frame on flush when PCM remains buffered", () => {
    encode.mockReturnValueOnce(new Uint8Array([7]))
    const encoder = oggChunkedEncoderDefinition.create({
      sampleRate: 48000,
      channels: 1,
    })

    encoder.feedFrame(1, 48000, mono([1]))
    const result = encoder.flush()

    expect(encode).toHaveBeenCalledWith(new Int16Array([1, 0, 0, 0]))
    expect(oggMuxerInstances[0]?.writeFinalFrame).toHaveBeenCalledWith(
      new Uint8Array([7]),
      6n
    )
    expect(result).toEqual(new Uint8Array([30, 6]))
  })

  it("emits a silent final OGG page when the PCM buffer is empty", () => {
    encode
      .mockReturnValueOnce(new Uint8Array([1]))
      .mockReturnValueOnce(new Uint8Array([2]))
    const encoder = oggChunkedEncoderDefinition.create({
      sampleRate: 48000,
      channels: 1,
    })

    encoder.feedFrame(1, 48000, mono([1, 2, 3, 4]))
    const result = encoder.flush()

    expect(encode).toHaveBeenNthCalledWith(2, new Int16Array([0, 0, 0, 0]))
    expect(oggMuxerInstances[0]?.writeFinalFrame).toHaveBeenCalledWith(
      new Uint8Array([2]),
      10n
    )
    expect(result).toEqual(new Uint8Array([30, 10]))
  })

  it("disposes the OGG encoder", () => {
    const encoder = oggChunkedEncoderDefinition.create()

    encoder.dispose()

    expect(free).toHaveBeenCalledTimes(1)
  })

  it("buffers WebM frames, emits headers once, and advances timestamps", () => {
    encode
      .mockReturnValueOnce(new Uint8Array([1]))
      .mockReturnValueOnce(new Uint8Array([2]))
    const encoder = webmChunkedEncoderDefinition.create({
      sampleRate: 8000,
      channels: 1,
    })

    expect(encoder.feedFrame(1, 8000, mono([1, 2]))).toEqual(
      new Uint8Array([40])
    )
    const result = encoder.feedFrame(1, 8000, mono([3, 4, 5, 6, 7, 8]))

    expect(encode).toHaveBeenNthCalledWith(1, new Int16Array([1, 2, 3, 4]))
    expect(encode).toHaveBeenNthCalledWith(2, new Int16Array([5, 6, 7, 8]))
    expect(webmMuxerInstances[0]?.options).toEqual({
      sampleRate: 8000,
      channels: 1,
      frameDurationMs: 0.5,
    })
    expect(webmMuxerInstances[0]?.writeFrame).toHaveBeenNthCalledWith(
      1,
      new Uint8Array([1]),
      0
    )
    expect(webmMuxerInstances[0]?.writeFrame).toHaveBeenNthCalledWith(
      2,
      new Uint8Array([2]),
      0
    )
    expect(result).toEqual(new Uint8Array([50, 0, 50, 0]))
  })

  it("pads the final WebM frame and appends finalize output", () => {
    encode.mockReturnValueOnce(new Uint8Array([5]))
    const encoder = webmChunkedEncoderDefinition.create({
      sampleRate: 8000,
      channels: 1,
    })

    encoder.feedFrame(1, 8000, mono([1, 2]))
    const result = encoder.flush()

    expect(encode).toHaveBeenCalledWith(new Int16Array([1, 2, 0, 0]))
    expect(webmMuxerInstances[0]?.writeFrame).toHaveBeenCalledWith(
      new Uint8Array([5]),
      0
    )
    expect(webmMuxerInstances[0]?.finalize).toHaveBeenCalledTimes(1)
    expect(result).toEqual(new Uint8Array([50, 0, 60]))
  })

  it("returns null when WebM flush has no pending frame and finalize is empty", () => {
    const encoder = webmChunkedEncoderDefinition.create()
    webmMuxerInstances[0]!.finalize.mockReturnValueOnce(new Uint8Array(0))

    expect(encoder.flush()).toBeNull()
  })

  it("disposes the WebM encoder", () => {
    const encoder = webmChunkedEncoderDefinition.create()

    encoder.dispose()

    expect(free).toHaveBeenCalledTimes(1)
  })
})
