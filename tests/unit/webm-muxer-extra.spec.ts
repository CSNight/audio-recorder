import { describe, expect, it } from "vitest"
import { WebmMuxer } from "@/codecs/opus/muxers/webm/webm-muxer"

// ---- helpers ---------------------------------------------------------------

function readAscii(buf: Uint8Array, offset: number, len: number): string {
  return Array.from({ length: len }, (_, i) =>
    String.fromCharCode(buf[offset + i]!)
  ).join("")
}

/** Read big-endian float64 at offset */
function readFloat64BE(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8)
  return view.getFloat64(0, false)
}

// ---- finalize() -------------------------------------------------------------

describe("WebmMuxer — finalize()", () => {
  it("returns an empty Uint8Array (streaming WebM needs no finalizer)", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    const result = muxer.finalize()
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(0)
  })

  it("can be called before any frames are written", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 2 })
    expect(() => muxer.finalize()).not.toThrow()
  })

  it("can be called after frames are written", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    muxer.getHeaders()
    muxer.writeFrame(new Uint8Array(20), 0)
    const result = muxer.finalize()
    expect(result.length).toBe(0)
  })

  it("can be called multiple times without throwing", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    expect(() => {
      muxer.finalize()
      muxer.finalize()
    }).not.toThrow()
  })
})

// ---- Info element: MuxingApp / WritingApp -----------------------------------

describe("WebmMuxer — Info element strings", () => {
  function getHeaderBytes(): Uint8Array {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    return muxer.getHeaders()
  }

  it("contains MuxingApp element ID (0x4d80)", () => {
    const headers = getHeaderBytes()
    const hi = 0x4d
    const lo = 0x80
    let found = false
    for (let i = 0; i < headers.length - 1; i++) {
      if (headers[i] === hi && headers[i + 1] === lo) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it("contains WritingApp element ID (0x5741)", () => {
    const headers = getHeaderBytes()
    const hi = 0x57
    const lo = 0x41
    let found = false
    for (let i = 0; i < headers.length - 1; i++) {
      if (headers[i] === hi && headers[i + 1] === lo) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })

  it("embeds 'audio-recorder' string somewhere in the headers", () => {
    const headers = getHeaderBytes()
    const needle = new TextEncoder().encode("audio-recorder")
    outer: for (let i = 0; i <= headers.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (headers[i + j] !== needle[j]) continue outer
      }
      expect(true).toBe(true) // found
      return
    }
    expect(false).toBe(true) // not found
  })
})

// ---- Audio element: SamplingFrequency (float64) ----------------------------

describe("WebmMuxer — SamplingFrequency", () => {
  // SamplingFrequency element ID: 0xb5 (1-byte ID)
  // It stores an IEEE 754 float64 (8 bytes) big-endian

  function findSamplingFrequency(headers: Uint8Array): number | null {
    // Look for 0xb5 followed by VINT size 0x88 (data length 8)
    for (let i = 0; i < headers.length - 9; i++) {
      if (headers[i] === 0xb5 && headers[i + 1] === 0x88) {
        return readFloat64BE(headers, i + 2)
      }
    }
    return null
  }

  it("SamplingFrequency is 48000.0 for 48kHz stream", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    const headers = muxer.getHeaders()
    const freq = findSamplingFrequency(headers)
    expect(freq).toBe(48000)
  })

  it("SamplingFrequency is 44100.0 for 44.1kHz stream", () => {
    const muxer = new WebmMuxer({ sampleRate: 44100, channels: 1 })
    const headers = muxer.getHeaders()
    const freq = findSamplingFrequency(headers)
    expect(freq).toBe(44100)
  })

  it("SamplingFrequency is 16000.0 for 16kHz stream", () => {
    const muxer = new WebmMuxer({ sampleRate: 16000, channels: 1 })
    const headers = muxer.getHeaders()
    const freq = findSamplingFrequency(headers)
    expect(freq).toBe(16000)
  })
})

// ---- Multi-channel CodecPrivate ---------------------------------------------

describe("WebmMuxer — CodecPrivate for multi-channel", () => {
  function getCodecPrivate(channels: number): Uint8Array {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels })
    const headers = muxer.getHeaders()
    // CodecPrivate ID: 0x63a2
    const hi = 0x63
    const lo = 0xa2
    for (let i = 0; i < headers.length - 2; i++) {
      if (headers[i] === hi && headers[i + 1] === lo) {
        // VINT size after element ID
        const sizeByte = headers[i + 2]!
        const size = sizeByte & 0x7f // strip leading 1 bit (single-byte VINT)
        return headers.slice(i + 3, i + 3 + size)
      }
    }
    return new Uint8Array(0)
  }

  it("CodecPrivate starts with OpusHead signature for stereo", () => {
    const cp = getCodecPrivate(2)
    expect(readAscii(cp, 0, 8)).toBe("OpusHead")
  })

  it("CodecPrivate channel_count byte is correct for mono", () => {
    const cp = getCodecPrivate(1)
    expect(cp[9]).toBe(1)
  })

  it("CodecPrivate channel_count byte is correct for stereo", () => {
    const cp = getCodecPrivate(2)
    expect(cp[9]).toBe(2)
  })

  it("mapping_family is 0 for mono", () => {
    const cp = getCodecPrivate(1)
    expect(cp[18]).toBe(0)
  })

  it("mapping_family is 0 for stereo", () => {
    const cp = getCodecPrivate(2)
    expect(cp[18]).toBe(0)
  })

  it("mapping_family is 1 for 4-channel", () => {
    const cp = getCodecPrivate(4)
    expect(cp[18]).toBe(1)
  })
})
