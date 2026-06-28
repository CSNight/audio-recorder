import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AacEncoderHandle } from "@/codecs/aac/types"
import type { PcmBufferSnapshot } from "@/buffer/types"

const resample = vi.fn<(snapshot: PcmBufferSnapshot) => PcmBufferSnapshot>()
const createAacEncoder = vi.fn<(options: unknown) => AacEncoderHandle>()
const preloadAacModule = vi.fn()

vi.mock("audio-recorder", () => ({
  resample,
}))

vi.mock("@/codecs/aac/aac-wasm-api", () => ({
  createAacEncoder,
  preloadAacModule,
}))

const { aacChunkedEncoderDefinition } = await import(
  "@/codecs/aac/aac-chunked-encoder"
)

function mono(samples: number[]): Int16Array[] {
  return [new Int16Array(samples)]
}

function stereo(left: number[], right: number[]): Int16Array[] {
  return [new Int16Array(left), new Int16Array(right)]
}

function decodeFrames(bytes: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = []
  let offset = 0

  while (offset < bytes.length) {
    const frameLength =
      ((bytes[offset + 3]! & 0x03) << 11) |
      (bytes[offset + 4]! << 3) |
      (bytes[offset + 5]! >> 5)
    frames.push(bytes.subarray(offset, offset + frameLength))
    offset += frameLength
  }

  return frames
}

describe("aacChunkedEncoderDefinition", () => {
  const encode = vi.fn()
  const flush = vi.fn()
  const free = vi.fn()

  beforeEach(() => {
    resample.mockReset()
    createAacEncoder.mockReset()
    preloadAacModule.mockReset()
    encode.mockReset()
    flush.mockReset()
    free.mockReset()

    resample.mockImplementation((snapshot) => snapshot)
    createAacEncoder.mockImplementation(
      (options) =>
        ({
          sampleRate: (options as { sampleRate: number }).sampleRate,
          channels: (options as { channels: number }).channels,
          bitrate: (options as { bitrate?: number }).bitrate ?? 128000,
          frameSize: 4,
          audioSpecificConfig: new Uint8Array([0x12, 0x10]),
          encode,
          flush,
          free,
        }) as unknown as AacEncoderHandle
    )
  })

  it("exposes format and preload", () => {
    expect(aacChunkedEncoderDefinition.format).toBe("aac")
    expect(aacChunkedEncoderDefinition.preload).toBe(preloadAacModule)
  })

  it("returns null for empty frames without creating the encoder", () => {
    const encoder = aacChunkedEncoderDefinition.create()

    expect(encoder.feedFrame(1, 48000, mono([]))).toBeNull()
    expect(createAacEncoder).not.toHaveBeenCalled()
  })

  it("buffers PCM until a full AAC frame is available and wraps packets as ADTS", () => {
    encode.mockReturnValueOnce([new Uint8Array([9, 10])])
    const encoder = aacChunkedEncoderDefinition.create({ bitrate: 96000 })

    expect(encoder.feedFrame(2, 48000, stereo([1, 2], [3, 4]))).toBeNull()
    const result = encoder.feedFrame(2, 48000, stereo([5, 6], [7, 8]))

    expect(createAacEncoder).toHaveBeenCalledWith({
      channels: 2,
      sampleRate: 48000,
      bitrate: 96000,
    })
    expect(encode).toHaveBeenCalledWith(
      new Int16Array([1, 3, 2, 4, 5, 7, 6, 8])
    )
    expect(result).not.toBeNull()

    const frames = decodeFrames(result!)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.subarray(0, 2)).toEqual(new Uint8Array([0xff, 0xf1]))
    expect(frames[0]?.subarray(7)).toEqual(new Uint8Array([9, 10]))
  })

  it("resamples to the requested sampleRate before creating the encoder", () => {
    resample.mockReturnValueOnce({
      sampleRate: 44100,
      channels: 1,
      frameCount: 1,
      durationMs: 1000 / 44100,
      planar: mono([11, 12, 13, 14]),
    })
    encode.mockReturnValueOnce([new Uint8Array([1])])
    const encoder = aacChunkedEncoderDefinition.create({ sampleRate: 44100 })

    encoder.feedFrame(1, 48000, mono([1, 2, 3, 4]))

    expect(resample).toHaveBeenCalledTimes(1)
    expect(createAacEncoder).toHaveBeenCalledWith({
      channels: 1,
      sampleRate: 44100,
    })
  })

  it("throws when the stream format changes after encoder creation", () => {
    encode.mockReturnValue([])
    const encoder = aacChunkedEncoderDefinition.create()

    encoder.feedFrame(1, 48000, mono([1, 2, 3, 4]))

    expect(() =>
      encoder.feedFrame(2, 48000, stereo([1, 2, 3, 4], [5, 6, 7, 8]))
    ).toThrow("mid-stream format changes")
  })

  it("pads the final frame on flush and appends encoder.flush packets", () => {
    encode.mockReturnValueOnce([new Uint8Array([7])])
    flush.mockReturnValueOnce([new Uint8Array([8, 9])])
    const encoder = aacChunkedEncoderDefinition.create()

    encoder.feedFrame(1, 48000, mono([1, 2, 3]))
    const result = encoder.flush()

    expect(encode).toHaveBeenCalledWith(new Int16Array([1, 2, 3, 0]))
    expect(flush).toHaveBeenCalledTimes(1)
    expect(result).not.toBeNull()

    const frames = decodeFrames(result!)
    expect(frames).toHaveLength(2)
    expect(frames[0]?.subarray(7)).toEqual(new Uint8Array([7]))
    expect(frames[1]?.subarray(7)).toEqual(new Uint8Array([8, 9]))
  })

  it("returns null on flush before the encoder is created", () => {
    const encoder = aacChunkedEncoderDefinition.create()

    expect(encoder.flush()).toBeNull()
  })

  it("frees the encoder on dispose and recreates it for a new stream", () => {
    encode.mockReturnValue([])
    const encoder = aacChunkedEncoderDefinition.create()

    encoder.feedFrame(1, 48000, mono([1, 2, 3, 4]))
    encoder.dispose()
    encoder.feedFrame(1, 44100, mono([5, 6, 7, 8]))

    expect(free).toHaveBeenCalledTimes(1)
    expect(createAacEncoder).toHaveBeenNthCalledWith(1, {
      channels: 1,
      sampleRate: 48000,
    })
    expect(createAacEncoder).toHaveBeenNthCalledWith(2, {
      channels: 1,
      sampleRate: 44100,
    })
  })
})
