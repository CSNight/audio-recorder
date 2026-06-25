import { describe, expect, it, vi, beforeEach } from "vitest"

// Mock lamejs Mp3Encoder before importing the module
const mockEncodeBuffer = vi.fn()
const mockFlush = vi.fn()

// Use a class so `new Mp3Encoder(...)` works correctly
class MockMp3Encoder {
  encodeBuffer = mockEncodeBuffer
  flush = mockFlush
}
const MockMp3EncoderSpy = vi.fn().mockImplementation(function (
  channels: number,
  sampleRate: number,
  kbps: number
) {
  // Record constructor call args on the spy
  void channels
  void sampleRate
  void kbps
  return new MockMp3Encoder()
})

vi.mock("@/codecs/mp3/vendor/lame.all.js", () => ({
  Mp3Encoder: MockMp3EncoderSpy,
}))

// Import after mock is set up
const { mp3ChunkedEncoderDefinition } =
  await import("@/codecs/mp3/mp3-chunked-encoder")

// Helper: create an Int16Array of given length
function pcm(length: number, value = 1000): Int16Array {
  return new Int16Array(length).fill(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: encodeBuffer returns empty Int8Array (buffering), flush returns some bytes
  mockEncodeBuffer.mockReturnValue(new Int8Array(0))
  mockFlush.mockReturnValue(new Int8Array([0x49, 0x44, 0x33]))
})

describe("mp3ChunkedEncoderDefinition", () => {
  it("has format 'mp3'", () => {
    expect(mp3ChunkedEncoderDefinition.format).toBe("mp3")
  })

  it("create() returns object with feedFrame, flush, dispose", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    expect(typeof enc.feedFrame).toBe("function")
    expect(typeof enc.flush).toBe("function")
    expect(typeof enc.dispose).toBe("function")
  })
})

describe("mp3ChunkedEncoder: lazy initialization", () => {
  it("does NOT create Mp3Encoder until first feedFrame call", () => {
    mp3ChunkedEncoderDefinition.create()
    expect(MockMp3EncoderSpy).not.toHaveBeenCalled()
  })

  it("creates Mp3Encoder on first feedFrame with correct params", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    expect(MockMp3EncoderSpy).toHaveBeenCalledTimes(1)
    expect(MockMp3EncoderSpy).toHaveBeenCalledWith(1, 44100, 128)
  })

  it("uses custom bitrateKbps when provided", () => {
    const enc = mp3ChunkedEncoderDefinition.create({ bitrateKbps: 320 })
    enc.feedFrame(2, 48000, [pcm(1152), pcm(1152)])
    expect(MockMp3EncoderSpy).toHaveBeenCalledWith(2, 48000, 320)
  })

  it("does NOT recreate encoder on subsequent feedFrame calls with same params", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    enc.feedFrame(1, 44100, [pcm(1152)])
    enc.feedFrame(1, 44100, [pcm(1152)])
    expect(MockMp3EncoderSpy).toHaveBeenCalledTimes(1)
  })
})

describe("mp3ChunkedEncoder: feedFrame behavior", () => {
  it("returns null when planar[0] is empty", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    const result = enc.feedFrame(1, 44100, [new Int16Array(0)])
    expect(result).toBeNull()
  })

  it("returns null when encodeBuffer returns empty array (buffering)", () => {
    mockEncodeBuffer.mockReturnValue(new Int8Array(0))
    const enc = mp3ChunkedEncoderDefinition.create()
    const result = enc.feedFrame(1, 44100, [pcm(1152)])
    expect(result).toBeNull()
  })

  it("returns Uint8Array when encodeBuffer produces bytes", () => {
    mockEncodeBuffer.mockReturnValue(new Int8Array([0x4d, 0x50, 0x33]))
    const enc = mp3ChunkedEncoderDefinition.create()
    const result = enc.feedFrame(1, 44100, [pcm(1152)])
    expect(result).toBeInstanceOf(Uint8Array)
    expect(Array.from(result!)).toEqual([0x4d, 0x50, 0x33])
  })

  it("converts Int8Array sign correctly: -1 becomes 255", () => {
    mockEncodeBuffer.mockReturnValue(new Int8Array([-1, -128, 127]))
    const enc = mp3ChunkedEncoderDefinition.create()
    const result = enc.feedFrame(1, 44100, [pcm(1152)])
    expect(Array.from(result!)).toEqual([255, 128, 127])
  })

  it("passes left=planar[0] and right=planar[0] for mono", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    const left = pcm(1152, 300)
    enc.feedFrame(1, 44100, [left])
    expect(mockEncodeBuffer).toHaveBeenCalledWith(left, left)
  })

  it("passes left=planar[0] and right=planar[1] for stereo", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    const left = pcm(1152, 300)
    const right = pcm(1152, -300)
    enc.feedFrame(2, 44100, [left, right])
    expect(mockEncodeBuffer).toHaveBeenCalledWith(left, right)
  })

  it("for 3+ channels: uses planar[0] as left and planar[1] as right", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    const ch0 = pcm(1152, 100)
    const ch1 = pcm(1152, 200)
    const ch2 = pcm(1152, 300)
    enc.feedFrame(3, 44100, [ch0, ch1, ch2])
    expect(mockEncodeBuffer).toHaveBeenCalledWith(ch0, ch1)
  })
})

describe("mp3ChunkedEncoder: flush behavior", () => {
  it("returns null before any feedFrame call (no encoder created)", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    expect(enc.flush()).toBeNull()
    expect(mockFlush).not.toHaveBeenCalled()
  })

  it("returns Uint8Array from lame flush after encoding frames", () => {
    mockFlush.mockReturnValue(new Int8Array([0x49, 0x44, 0x33]))
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    const result = enc.flush()
    expect(result).toBeInstanceOf(Uint8Array)
    expect(mockFlush).toHaveBeenCalledTimes(1)
  })

  it("returns null when lame flush returns empty bytes", () => {
    mockFlush.mockReturnValue(new Int8Array(0))
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    expect(enc.flush()).toBeNull()
  })

  it("flush() nullifies encoder — second flush returns null without calling lame", () => {
    mockFlush.mockReturnValue(new Int8Array([0x01]))
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    enc.flush() // first flush — encoder nullified
    const second = enc.flush() // no encoder now
    expect(second).toBeNull()
    expect(mockFlush).toHaveBeenCalledTimes(1) // lame flush only once
  })
})

describe("mp3ChunkedEncoder: dispose behavior", () => {
  it("dispose() before any frame — subsequent flush returns null", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.dispose()
    expect(enc.flush()).toBeNull()
  })

  it("dispose() after encoding — flush returns null (encoder cleared)", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    enc.dispose()
    expect(enc.flush()).toBeNull()
    expect(mockFlush).not.toHaveBeenCalled()
  })

  it("dispose() after flush — no error, flush still returns null", () => {
    const enc = mp3ChunkedEncoderDefinition.create()
    enc.feedFrame(1, 44100, [pcm(1152)])
    enc.flush()
    expect(() => enc.dispose()).not.toThrow()
    expect(enc.flush()).toBeNull()
  })
})
