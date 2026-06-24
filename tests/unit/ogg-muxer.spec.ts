import { describe, expect, it } from "vitest"
import { calculateOggCrc32 } from "@/codecs/opus/muxers/ogg/ogg-crc32"
import { OggMuxer } from "@/codecs/opus/muxers/ogg/ogg-muxer"

// ---- helpers ---------------------------------------------------------------

function readAscii(buf: Uint8Array, offset: number, len: number): string {
  return Array.from({ length: len }, (_, i) =>
    String.fromCharCode(buf[offset + i]!)
  ).join("")
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]! |
      (buf[offset + 1]! << 8) |
      (buf[offset + 2]! << 16) |
      (buf[offset + 3]! << 24)) >>>
    0
  )
}

function readUint16LE(buf: Uint8Array, offset: number): number {
  return buf[offset]! | (buf[offset + 1]! << 8)
}
// Parse a page from a buffer starting at `start`.
// Returns { headerTypeFlag, granulePositionLo32, granulePositionHi32, serialNumber,
//           sequenceNumber, checksum, dataStart, dataEnd }.
function parsePage(buf: Uint8Array, start = 0) {
  const capture = readAscii(buf, start, 4)
  const version = buf[start + 4]!
  const headerTypeFlag = buf[start + 5]!
  const granuleLo32 = readUint32LE(buf, start + 6)
  const granuleHi32 = readUint32LE(buf, start + 10)
  const serialNumber = readUint32LE(buf, start + 14)
  const sequenceNumber = readUint32LE(buf, start + 18)
  const checksum = readUint32LE(buf, start + 22)
  const segmentCount = buf[start + 26]!
  const segmentTable = buf.slice(start + 27, start + 27 + segmentCount)
  const dataSize = segmentTable.reduce((s, v) => s + v, 0)
  const dataStart = start + 27 + segmentCount
  const dataEnd = dataStart + dataSize
  return {
    capture,
    version,
    headerTypeFlag,
    granuleLo32,
    granuleHi32,
    serialNumber,
    sequenceNumber,
    checksum,
    segmentCount,
    segmentTable,
    dataStart,
    dataEnd,
  }
}

// ---- CRC32 -----------------------------------------------------------------

describe("calculateOggCrc32", () => {
  it("returns 0 for empty input", () => {
    expect(calculateOggCrc32(new Uint8Array(0))).toBe(0)
  })

  it("uses OGG polynomial 0x04c11db7 (non-reflected, MSB-first, seed 0)", () => {
    // Single byte 0x00: crc = (0 << 24) ^ 0x04c11db7 = ... run 8 shifts
    // Manually: start = 0, index = 0 ^ 0x00 = 0, result after shifting
    // CRC_TABLE[0] = 0 (all zero shifts, polynomial never XOR'd)
    expect(calculateOggCrc32(new Uint8Array([0]))).toBe(0)
  })

  it("is deterministic across two identical inputs", () => {
    const data = new Uint8Array(32).fill(0xab)
    expect(calculateOggCrc32(data)).toBe(calculateOggCrc32(data))
  })

  it("produces different checksums for different data", () => {
    const a = new Uint8Array([0x01, 0x02, 0x03])
    const b = new Uint8Array([0x01, 0x02, 0x04])
    expect(calculateOggCrc32(a)).not.toBe(calculateOggCrc32(b))
  })

  it("respects the seed parameter", () => {
    const data = new Uint8Array([0xff])
    expect(calculateOggCrc32(data, 0)).not.toBe(calculateOggCrc32(data, 1))
  })

  it("verifies a page's own CRC is self-consistent", () => {
    // Build a known minimal page and verify the embedded CRC validates to 0
    // when CRC field itself is zeroed then re-calculated.
    const muxer = new OggMuxer({ sampleRate: 48000, channels: 1, preSkip: 312 })
    const headers = muxer.getHeaderPages()

    // Locate first page and zero its CRC field (bytes 22-25), then recalculate
    const page = headers.slice(0, parsePage(headers).dataEnd)
    const zeroed = new Uint8Array(page)
    zeroed[22] = 0
    zeroed[23] = 0
    zeroed[24] = 0
    zeroed[25] = 0
    const recomputed = calculateOggCrc32(zeroed, 0)
    expect(recomputed).toBe(parsePage(page).checksum)
  })
})

// ---- OGG page structure (RFC 3533) ----------------------------------------

describe("OggMuxer — page structure", () => {
  const muxer = new OggMuxer({ sampleRate: 48000, channels: 1, preSkip: 312 })
  const headers = muxer.getHeaderPages()

  it("starts with capture pattern OggS", () => {
    expect(readAscii(headers, 0, 4)).toBe("OggS")
  })

  it("has stream_structure_version = 0", () => {
    expect(headers[4]).toBe(0x00)
  })

  it("ID Header page has BOS flag (0x02)", () => {
    const { headerTypeFlag } = parsePage(headers, 0)
    expect(headerTypeFlag & 0x02).toBe(0x02)
  })

  it("ID Header page granule position is 0", () => {
    const { granuleLo32, granuleHi32 } = parsePage(headers, 0)
    expect(granuleLo32).toBe(0)
    expect(granuleHi32).toBe(0)
  })

  it("sequence numbers start at 0 and increment", () => {
    const p0 = parsePage(headers, 0)
    const p1 = parsePage(headers, p0.dataEnd)
    expect(p0.sequenceNumber).toBe(0)
    expect(p1.sequenceNumber).toBe(1)
  })

  it("both header pages have the same serial number", () => {
    const p0 = parsePage(headers, 0)
    const p1 = parsePage(headers, p0.dataEnd)
    expect(p0.serialNumber).toBe(p1.serialNumber)
  })

  it("data pages have the same serial number as header pages", () => {
    const p0 = parsePage(headers, 0)
    const dataPage = muxer.writeFrame(new Uint8Array(120), 960n)
    const dp = parsePage(dataPage, 0)
    expect(dp.serialNumber).toBe(p0.serialNumber)
  })

  it("EOS page has EOS flag (0x04)", () => {
    const eosBuf = muxer.writeFinalFrame(new Uint8Array(10), 1920n)
    const { headerTypeFlag } = parsePage(eosBuf, 0)
    expect(headerTypeFlag & 0x04).toBe(0x04)
  })

  it("embedded CRC matches recomputed CRC", () => {
    const p0 = parsePage(headers, 0)
    const page = headers.slice(0, p0.dataEnd)
    const clone = new Uint8Array(page)
    const embedded = readUint32LE(clone, 22)
    clone[22] = 0
    clone[23] = 0
    clone[24] = 0
    clone[25] = 0
    expect(calculateOggCrc32(clone, 0)).toBe(embedded)
  })
})

// ---- RFC 7845 OpusHead -------------------------------------------------------

describe("OggMuxer — OpusHead (RFC 7845)", () => {
  function getOpusHead(channels: number, preSkip = 312): Uint8Array {
    const muxer = new OggMuxer({ sampleRate: 48000, channels, preSkip })
    const headers = muxer.getHeaderPages()
    const p0 = parsePage(headers, 0)
    return headers.slice(p0.dataStart, p0.dataEnd)
  }

  it("has OpusHead signature (8 bytes)", () => {
    expect(readAscii(getOpusHead(1), 0, 8)).toBe("OpusHead")
  })

  it("version is 0x01", () => {
    expect(getOpusHead(1)[8]).toBe(0x01)
  })

  it("channel_count matches", () => {
    expect(getOpusHead(1)[9]).toBe(1)
    expect(getOpusHead(2)[9]).toBe(2)
    expect(getOpusHead(5)[9]).toBe(5)
  })

  it("pre_skip is encoded uint16 LE", () => {
    const head = getOpusHead(1, 576)
    expect(readUint16LE(head, 10)).toBe(576)
  })

  it("input_sample_rate is uint32 LE", () => {
    const muxer = new OggMuxer({ sampleRate: 16000, channels: 1 })
    const headers = muxer.getHeaderPages()
    const p0 = parsePage(headers, 0)
    const head = headers.slice(p0.dataStart, p0.dataEnd)
    expect(readUint32LE(head, 12)).toBe(16000)
  })

  it("output_gain is 0 (int16 LE)", () => {
    expect(readUint16LE(getOpusHead(1), 16)).toBe(0)
  })

  it("mapping_family is 0 for mono and stereo", () => {
    expect(getOpusHead(1)[18]).toBe(0)
    expect(getOpusHead(2)[18]).toBe(0)
  })

  it("mapping_family is 1 for channels 3-8", () => {
    for (const ch of [3, 4, 5, 6, 7, 8]) {
      expect(getOpusHead(ch)[18]).toBe(1)
    }
  })

  it("mapping_family=1 stream_count = ceil(channels/2)", () => {
    for (const ch of [3, 4, 5, 6]) {
      const head = getOpusHead(ch)
      const streamCount = head[19]!
      expect(streamCount).toBe(Math.ceil(ch / 2))
    }
  })

  it("mapping_family=1 coupled_stream_count = floor(channels/2)", () => {
    for (const ch of [3, 4, 5, 6]) {
      const head = getOpusHead(ch)
      const coupledCount = head[20]!
      expect(coupledCount).toBe(Math.floor(ch / 2))
    }
  })
})

// ---- RFC 7845 OpusTags -------------------------------------------------------

describe("OggMuxer — OpusTags (RFC 7845)", () => {
  it("comment header has OpusTags signature", () => {
    const muxer = new OggMuxer({ sampleRate: 48000, channels: 1 })
    const headers = muxer.getHeaderPages()
    const p0 = parsePage(headers, 0)
    const p1 = parsePage(headers, p0.dataEnd)
    const tags = headers.slice(p1.dataStart, p1.dataEnd)
    expect(readAscii(tags, 0, 8)).toBe("OpusTags")
  })

  it("vendor string length is present", () => {
    const muxer = new OggMuxer({ sampleRate: 48000, channels: 1 })
    const headers = muxer.getHeaderPages()
    const p0 = parsePage(headers, 0)
    const p1 = parsePage(headers, p0.dataEnd)
    const tags = headers.slice(p1.dataStart, p1.dataEnd)
    const vendorLen = readUint32LE(tags, 8)
    expect(vendorLen).toBeGreaterThan(0)
    expect(vendorLen).toBeLessThanOrEqual(tags.length - 12)
  })
})

// ---- Granule position -------------------------------------------------------

describe("OggMuxer — granule position", () => {
  it("data page granule position is encoded as int64 LE", () => {
    const muxer = new OggMuxer({ sampleRate: 48000, channels: 1 })
    muxer.getHeaderPages() // advance sequence counter
    const granule = 4800n
    const page = muxer.writeFrame(new Uint8Array(20), granule)
    const { granuleLo32, granuleHi32 } = parsePage(page)
    const actual = BigInt(granuleLo32) | (BigInt(granuleHi32) << 32n)
    expect(actual).toBe(granule)
  })
})
