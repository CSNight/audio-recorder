import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FlacEncoderHandle } from "@/codecs/flac/types"

const createFlacEncoder = vi.fn<(options: unknown) => FlacEncoderHandle>()
const preloadFlacModule = vi.fn()

vi.mock("@/codecs/flac/flac-wasm-api", () => ({
  createFlacEncoder,
  preloadFlacModule,
}))

const { flacChunkedEncoderDefinition } =
  await import("@/codecs/flac/flac-chunked-encoder")

function mono(samples: number[]): Int16Array[] {
  return [new Int16Array(samples)]
}

function stereo(left: number[], right: number[]): Int16Array[] {
  return [new Int16Array(left), new Int16Array(right)]
}

describe("flacChunkedEncoderDefinition", () => {
  const encode = vi.fn()
  const flush = vi.fn()
  const free = vi.fn()

  beforeEach(() => {
    encode.mockReset()
    flush.mockReset()
    free.mockReset()
    createFlacEncoder.mockReset()
    preloadFlacModule.mockReset()

    createFlacEncoder.mockImplementation(
      (options) =>
        ({
          sampleRate: (options as { sampleRate: number }).sampleRate,
          channels: (options as { channels: number }).channels,
          bitsPerSample: (options as { bitsPerSample: number }).bitsPerSample,
          encode,
          flush,
          free,
        }) as unknown as FlacEncoderHandle
    )
  })

  it("exposes format and preload", () => {
    expect(flacChunkedEncoderDefinition.format).toBe("flac")
    expect(flacChunkedEncoderDefinition.preload).toBe(preloadFlacModule)
  })

  it("creates the FLAC encoder eagerly with default options", () => {
    const encoder = flacChunkedEncoderDefinition.create()

    expect(createFlacEncoder).toHaveBeenCalledWith({
      sampleRate: 48000,
      channels: 1,
      bitsPerSample: 16,
      compressionLevel: 5,
    })
    expect(typeof encoder.feedFrame).toBe("function")
    expect(typeof encoder.flush).toBe("function")
    expect(typeof encoder.dispose).toBe("function")
  })

  it("passes custom bitsPerSample and compressionLevel into createFlacEncoder", () => {
    flacChunkedEncoderDefinition.create({
      bitsPerSample: 24,
      compressionLevel: 8,
    })

    expect(createFlacEncoder).toHaveBeenCalledWith({
      sampleRate: 48000,
      channels: 1,
      bitsPerSample: 24,
      compressionLevel: 8,
    })
  })

  it("returns null for empty frames without calling encode", () => {
    const encoder = flacChunkedEncoderDefinition.create()

    expect(encoder.feedFrame(1, 48000, mono([]))).toBeNull()
    expect(encode).not.toHaveBeenCalled()
  })

  it("interleaves stereo PCM and returns the encoded bytes", () => {
    encode.mockReturnValueOnce(new Uint8Array([9, 8, 7]))
    const encoder = flacChunkedEncoderDefinition.create()

    const result = encoder.feedFrame(2, 44100, stereo([1, 2], [3, 4]))

    expect(encode).toHaveBeenCalledWith(new Int16Array([1, 3, 2, 4]), 2)
    expect(result).toEqual(new Uint8Array([9, 8, 7]))
  })

  it("returns null when encode yields no bytes", () => {
    encode.mockReturnValueOnce(new Uint8Array(0))
    const encoder = flacChunkedEncoderDefinition.create()

    expect(encoder.feedFrame(1, 48000, mono([1, 2, 3]))).toBeNull()
  })

  it("returns null when flush yields no bytes", () => {
    flush.mockReturnValueOnce(new Uint8Array(0))
    const encoder = flacChunkedEncoderDefinition.create()

    expect(encoder.flush()).toBeNull()
  })

  it("returns the final FLAC bytes from flush", () => {
    flush.mockReturnValueOnce(new Uint8Array([5, 4, 3]))
    const encoder = flacChunkedEncoderDefinition.create()

    expect(encoder.flush()).toEqual(new Uint8Array([5, 4, 3]))
  })

  it("disposes the underlying encoder", () => {
    const encoder = flacChunkedEncoderDefinition.create()

    encoder.dispose()
    encoder.dispose()

    expect(free).toHaveBeenCalledTimes(2)
  })
})
