import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Mp3WasmEncoderHandle } from "@/codecs/mp3/types"

const preloadMp3Module = vi.fn(async () => {})
const createMp3Encoder =
  vi.fn<(options: unknown, channels: 1 | 2) => Mp3WasmEncoderHandle>()

const mockEncode =
  vi.fn<
    (left: Int16Array, right: Int16Array, sampleCount: number) => Uint8Array
  >()
const mockFlush = vi.fn<() => Uint8Array>()
const mockFree = vi.fn<() => void>()

vi.mock("@/codecs/mp3/mp3-wasm-api", () => ({
  preloadMp3Module,
  createMp3Encoder,
  resolveMp3EncoderOptions: (
    options: Record<string, unknown> = {},
    sampleRate: number,
    channels: number
  ) => ({
    bitrateKbps: (options.bitrateKbps as number | undefined) ?? 128,
    mode: (options.mode as string | undefined) ?? "cbr",
    vbrQuality: (options.vbrQuality as number | undefined) ?? 4,
    sampleRate: ((options.sampleRate as number | undefined) ?? sampleRate) as
      | 8000
      | 11025
      | 12000
      | 16000
      | 22050
      | 24000
      | 32000
      | 44100
      | 48000,
    channelMode:
      (options.channelMode as string | undefined) ??
      (channels > 1 ? "stereo" : "mono"),
    quality: (options.quality as number | undefined) ?? 2,
  }),
}))

const { mp3ChunkedEncoderDefinition } =
  await import("@/codecs/mp3/mp3-chunked-encoder")

function pcm(length: number, value = 1000): Int16Array {
  return new Int16Array(length).fill(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEncode.mockReturnValue(new Uint8Array(0))
  mockFlush.mockReturnValue(new Uint8Array([0x49, 0x44, 0x33]))
  createMp3Encoder.mockImplementation(
    (options: unknown, channels: 1 | 2) =>
      ({
        sampleRate: (options as { sampleRate: 44100 | 48000 }).sampleRate,
        channels,
        encode: mockEncode,
        flush: mockFlush,
        free: mockFree,
      }) as Mp3WasmEncoderHandle
  )
})

describe("mp3ChunkedEncoderDefinition", () => {
  it("has format 'mp3'", () => {
    expect(mp3ChunkedEncoderDefinition.format).toBe("mp3")
  })

  it("exposes preload and create", async () => {
    expect(mp3ChunkedEncoderDefinition.preload).toBe(preloadMp3Module)
    await mp3ChunkedEncoderDefinition.preload?.()
    expect(preloadMp3Module).toHaveBeenCalledTimes(1)
    const enc = mp3ChunkedEncoderDefinition.create()
    expect(typeof enc.feedFrame).toBe("function")
    expect(typeof enc.flush).toBe("function")
    expect(typeof enc.dispose).toBe("function")
  })
})

describe("mp3ChunkedEncoder", () => {
  it("creates the encoder lazily on first non-empty frame", () => {
    const enc = mp3ChunkedEncoderDefinition.create({ bitrateKbps: 192 })
    expect(createMp3Encoder).not.toHaveBeenCalled()
    enc.feedFrame(1, 44100, [pcm(1152)])
    expect(createMp3Encoder).toHaveBeenCalledTimes(1)
    expect(createMp3Encoder).toHaveBeenCalledWith(
      expect.objectContaining({ bitrateKbps: 192, channelMode: "mono" }),
      1
    )
  })

  it("returns null for empty frames", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    expect(enc.feedFrame(1, 44100, [new Int16Array(0)])).toBeNull()
    expect(createMp3Encoder).not.toHaveBeenCalled()
  })

  it("passes mono input to encode with duplicated channels", () => {
    mockEncode.mockReturnValue(new Uint8Array([1, 2, 3]))
    const enc = mp3ChunkedEncoderDefinition.create()
    const left = pcm(1152, 123)
    const result = enc.feedFrame(1, 44100, [left])
    expect(mockEncode).toHaveBeenCalledWith(left, left, 1152)
    expect(Array.from(result!)).toEqual([1, 2, 3])
  })

  it("defaults to stereo when input has more than one channel", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(2, 44100, [pcm(1152, 1), pcm(1152, 2)])
    expect(createMp3Encoder).toHaveBeenCalledWith(
      expect.objectContaining({ channelMode: "stereo" }),
      2
    )
  })

  it("supports explicit joint-stereo mode", () => {
    const enc = mp3ChunkedEncoderDefinition.create({
      channelMode: "joint-stereo",
    })
    enc.feedFrame(2, 44100, [pcm(1152, 1), pcm(1152, 2)])
    expect(createMp3Encoder).toHaveBeenCalledWith(
      expect.objectContaining({ channelMode: "joint-stereo" }),
      2
    )
  })

  it("downmixes multichannel input when channelMode is mono", () => {
    const enc = mp3ChunkedEncoderDefinition.create({ channelMode: "mono" })
    const ch0 = pcm(4, 10)
    const ch1 = pcm(4, 20)
    const ch2 = pcm(4, 40)
    enc.feedFrame(3, 44100, [ch0, ch1, ch2])
    const [left, right, sampleCount] = mockEncode.mock.calls[0]!
    expect(sampleCount).toBe(4)
    expect(Array.from(left as Int16Array)).toEqual([23, 23, 23, 23])
    expect(Array.from(right as Int16Array)).toEqual([23, 23, 23, 23])
  })

  it("uses the first two channels for stereo-oriented modes", () => {
    const enc = mp3ChunkedEncoderDefinition.create({ channelMode: "stereo" })
    const ch0 = pcm(4, 10)
    const ch1 = pcm(4, 20)
    const ch2 = pcm(4, 40)
    enc.feedFrame(3, 44100, [ch0, ch1, ch2])
    expect(mockEncode).toHaveBeenCalledWith(ch0, ch1, 4)
  })

  it("resamples to the requested sampleRate before encoding", () => {
    const enc = mp3ChunkedEncoderDefinition.create({ sampleRate: 44100 })
    const result = enc.feedFrame(1, 48000, [pcm(4800, 100)])
    expect(createMp3Encoder).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 44100 }),
      1
    )
    expect(mockEncode).toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it("throws on mid-stream format changes", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    expect(() => enc.feedFrame(1, 48000, [pcm(1152)])).toThrow(
      "MP3 chunked encoder does not support mid-stream format changes."
    )
  })

  it("flushes and frees the encoder", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    const result = enc.flush()
    expect(Array.from(result!)).toEqual([0x49, 0x44, 0x33])
    expect(mockFlush).toHaveBeenCalledTimes(1)
    expect(mockFree).toHaveBeenCalledTimes(1)
    expect(enc.flush()).toBeNull()
  })

  it("dispose releases encoder resources", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    enc.dispose()
    expect(mockFree).toHaveBeenCalledTimes(1)
    expect(enc.flush()).toBeNull()
  })
})
