import { describe, expect, it } from "vitest"
import { WebmMuxer } from "@/codecs/opus/muxers/webm/webm-muxer"
import { writeVint, writeElement } from "@/codecs/opus/muxers/webm/ebml-writer"

// ---- helpers ---------------------------------------------------------------

function readAscii(buf: Uint8Array, offset: number, len: number): string {
  return Array.from({ length: len }, (_, i) =>
    String.fromCharCode(buf[offset + i]!)
  ).join("")
}

// Read a big-endian EBML element ID (1-4 bytes, raw — NOT VINT-decoded)
// and return [id, bytesConsumed].
// Width is determined by leading bit pattern: 1xxx=1B, 01xx=2B, 001x=3B, 0001=4B.
function readEbmlId(buf: Uint8Array, offset: number): [number, number] {
  const first = buf[offset]!
  if (first & 0x80) return [first, 1]
  if (first & 0x40) return [((first << 8) | buf[offset + 1]!) >>> 0, 2]
  if (first & 0x20)
    return [
      ((first << 16) | (buf[offset + 1]! << 8) | buf[offset + 2]!) >>> 0,
      3,
    ]
  return [
    ((first << 24) |
      (buf[offset + 1]! << 16) |
      (buf[offset + 2]! << 8) |
      buf[offset + 3]!) >>>
      0,
    4,
  ]
}

// Read EBML data size VINT. Returns [size, bytesConsumed]. -1 means unknown size.
function readEbmlSize(buf: Uint8Array, offset: number): [number, number] {
  const first = buf[offset]!
  let bytes = 1
  let mask = 0x80
  while (!(first & mask) && bytes < 8) {
    bytes++
    mask >>= 1
  }
  // strip the marker bit to get the value
  let size = first & ~mask
  for (let i = 1; i < bytes; i++) {
    size = size * 256 + buf[offset + i]!
  }
  // All 1s (after stripping marker) means unknown size
  const allOnes = Math.pow(2, 7 * bytes) - 1
  if (size === allOnes) return [-1, bytes]
  return [size, bytes]
}

// Walk top-level EBML elements in buf, returning { id, dataOffset, dataLen }[]
function walkElements(
  buf: Uint8Array
): { id: number; dataOffset: number; dataLen: number }[] {
  const result: { id: number; dataOffset: number; dataLen: number }[] = []
  let pos = 0
  while (pos < buf.length) {
    const [id, idLen] = readEbmlId(buf, pos)
    if (pos + idLen >= buf.length) break
    const [size, sizeLen] = readEbmlSize(buf, pos + idLen)
    const dataOffset = pos + idLen + sizeLen
    result.push({ id, dataOffset, dataLen: size })
    if (size < 0) break // unknown size = rest of stream
    pos = dataOffset + size
  }
  return result
}

// ---- writeVint --------------------------------------------------------------

describe("writeVint", () => {
  it("encodes 1 as 0x81 (1-byte VINT)", () => {
    expect(writeVint(1)).toEqual(new Uint8Array([0x81]))
  })

  it("encodes 0x7f as 0xff (1-byte VINT max)", () => {
    expect(writeVint(0x7f)).toEqual(new Uint8Array([0xff]))
  })

  it("encodes 0x80 as 2-byte VINT", () => {
    const result = writeVint(0x80)
    expect(result.length).toBe(2)
    expect(result[0]! & 0x40).toBeTruthy() // leading bits 01
  })

  it("encodes 0 as 0x80 (zero value VINT, 1 byte)", () => {
    // VINT for value 0: first byte has leading 1 bit, data bits all 0 = 0x80
    expect(writeVint(0)[0]).toBe(0x80)
  })
})

// ---- writeElement -----------------------------------------------------------

describe("writeElement", () => {
  it("produces id | size | data layout with raw ID bytes", () => {
    const data = new Uint8Array([0x01, 0x02, 0x03])
    const el = writeElement(0x86, data) // 0x86 = single-byte element ID
    // ID: 0x86 written as raw byte (writeId, not writeVint)
    // Size: writeVint(3) = 0x83
    // Data: 01 02 03
    expect(el[0]).toBe(0x86)
    expect(el[1]).toBe(0x83) // VINT(3)
    expect(Array.from(el.slice(2))).toEqual([0x01, 0x02, 0x03])
  })
})

// ---- EBML Header ------------------------------------------------------------

describe("WebmMuxer — EBML Header", () => {
  const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
  const headers = muxer.getHeaders()

  // The EBML element ID is 0x1A45DFA3 (4 bytes, first nibble 0001 = 4-byte form)
  it("starts with EBML element ID 0x1A45DFA3", () => {
    const [id] = readEbmlId(headers, 0)
    expect(id).toBe(0x1a45dfa3)
  })

  it("DocType is 'webm'", () => {
    // Walk into EBML element content and find DocType (0x4282)
    const [, idLen] = readEbmlId(headers, 0)
    const [contentLen, sizeLen] = readEbmlSize(headers, idLen)
    const content = headers.slice(idLen + sizeLen, idLen + sizeLen + contentLen)
    const elements = walkElements(content)
    const docTypeEl = elements.find((e) => e.id === 0x4282)
    expect(docTypeEl).toBeDefined()
    const text = readAscii(content, docTypeEl!.dataOffset, docTypeEl!.dataLen)
    expect(text).toBe("webm")
  })

  it("DocTypeVersion is 2", () => {
    const [, idLen] = readEbmlId(headers, 0)
    const [contentLen, sizeLen] = readEbmlSize(headers, idLen)
    const content = headers.slice(idLen + sizeLen, idLen + sizeLen + contentLen)
    const elements = walkElements(content)
    const verEl = elements.find((e) => e.id === 0x4287)
    expect(verEl).toBeDefined()
    expect(content[verEl!.dataOffset]).toBe(2)
  })
})

// ---- Segment element --------------------------------------------------------

describe("WebmMuxer — Segment (unknown size)", () => {
  const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
  const headers = muxer.getHeaders()

  it("Segment element follows EBML header", () => {
    const [, idLen] = readEbmlId(headers, 0)
    const [ebmlSize, sizeLen] = readEbmlSize(headers, idLen)
    const afterEbml = idLen + sizeLen + ebmlSize
    const [segId] = readEbmlId(headers, afterEbml)
    expect(segId).toBe(0x18538067)
  })

  it("Segment size is unknown (0x01FFFFFFFFFFFFFF)", () => {
    const [, idLen] = readEbmlId(headers, 0)
    const [ebmlSize, sizeLen] = readEbmlSize(headers, idLen)
    const afterEbml = idLen + sizeLen + ebmlSize
    const [, segIdLen] = readEbmlId(headers, afterEbml)
    const [segSize] = readEbmlSize(headers, afterEbml + segIdLen)
    expect(segSize).toBe(-1) // unknown size
  })
})

// ---- CodecPrivate OpusHead --------------------------------------------------

describe("WebmMuxer — CodecPrivate (OpusHead)", () => {
  function findCodecPrivate(channels: number): Uint8Array {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels })
    const headers = muxer.getHeaders()
    // Scan for byte sequence 'OpusHead' (0x4f 0x70 0x75 0x73 0x48 0x65 0x61 0x64)
    const sig = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]
    for (let i = 0; i <= headers.length - sig.length; i++) {
      if (sig.every((b, j) => headers[i + j] === b)) {
        return headers.slice(i, i + 30)
      }
    }
    throw new Error("OpusHead not found in CodecPrivate")
  }

  it("CodecPrivate starts with OpusHead signature", () => {
    expect(readAscii(findCodecPrivate(1), 0, 8)).toBe("OpusHead")
  })

  it("version is 0x01", () => {
    expect(findCodecPrivate(1)[8]).toBe(0x01)
  })

  it("channel count matches", () => {
    expect(findCodecPrivate(1)[9]).toBe(1)
    expect(findCodecPrivate(2)[9]).toBe(2)
  })

  it("pre_skip is uint16 LE = 312 (0x38 0x01)", () => {
    const head = findCodecPrivate(1)
    const preSkip = head[10]! | (head[11]! << 8)
    expect(preSkip).toBe(312)
  })

  it("mapping_family is 0 for mono/stereo, 1 for > 2 channels", () => {
    expect(findCodecPrivate(1)[18]).toBe(0)
    expect(findCodecPrivate(2)[18]).toBe(0)
    expect(findCodecPrivate(3)[18]).toBe(1)
  })
})

// ---- CodecID ----------------------------------------------------------------

describe("WebmMuxer — CodecID A_OPUS", () => {
  it("contains A_OPUS string in headers", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    const headers = muxer.getHeaders()
    const text = new TextDecoder().decode(headers)
    expect(text).toContain("A_OPUS")
  })
})

// ---- TimestampScale ---------------------------------------------------------

describe("WebmMuxer — TimestampScale", () => {
  it("TimestampScale element (0x2AD7B1) encodes 1000000 (1ms)", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    const headers = muxer.getHeaders()
    // Scan for TimestampScale element ID bytes: 0x2A 0xD7 0xB1
    for (let i = 0; i < headers.length - 3; i++) {
      if (
        headers[i] === 0x2a &&
        headers[i + 1] === 0xd7 &&
        headers[i + 2] === 0xb1
      ) {
        // Skip ID (3 bytes) + size VINT (1 byte), read value
        const valueStart = i + 4
        // Value should be 0x0F4240 = 1000000 (3 bytes big-endian)
        const value =
          (headers[valueStart]! << 16) |
          (headers[valueStart + 1]! << 8) |
          headers[valueStart + 2]!
        expect(value).toBe(1_000_000)
        return
      }
    }
    throw new Error("TimestampScale element not found")
  })
})

// ---- SimpleBlock flags ------------------------------------------------------

describe("WebmMuxer — SimpleBlock", () => {
  it("first frame starts a Cluster (Cluster ID 0x1F43B675)", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    const data = muxer.writeFrame(new Uint8Array(120), 0)
    // Cluster ID bytes: 0x1F 0x43 0xB6 0x75
    const hasCluster = [...data].some(
      (_, i) =>
        data[i] === 0x1f &&
        data[i + 1] === 0x43 &&
        data[i + 2] === 0xb6 &&
        data[i + 3] === 0x75
    )
    expect(hasCluster).toBe(true)
  })

  it("SimpleBlock has keyframe flag 0x80", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    const data = muxer.writeFrame(new Uint8Array(20).fill(0xaa), 0)
    // SimpleBlock ID: 0xA3
    const sbOffset = [...data].findIndex((_, i) => data[i] === 0xa3)
    expect(sbOffset).toBeGreaterThanOrEqual(0)
    // Skip element ID (1 byte) + size VINT (1 byte) + track VINT (1 byte) + timecode (2 bytes)
    const flagsOffset = sbOffset + 1 + 1 + 1 + 2
    expect(data[flagsOffset]! & 0x80).toBe(0x80)
  })

  it("SimpleBlock lacing bits are 00 (no lacing)", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    const data = muxer.writeFrame(new Uint8Array(20).fill(0xaa), 0)
    const sbOffset = [...data].findIndex((_, i) => data[i] === 0xa3)
    const flagsOffset = sbOffset + 1 + 1 + 1 + 2
    expect(data[flagsOffset]! & 0x06).toBe(0x00) // bits 2:1 = no lacing
  })

  it("new cluster is started every 50 frames", () => {
    const muxer = new WebmMuxer({ sampleRate: 48000, channels: 1 })
    const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75]
    let clusterCount = 0
    for (let i = 0; i < 55; i++) {
      const frame = muxer.writeFrame(new Uint8Array(10), i * 20)
      for (let j = 0; j <= frame.length - 4; j++) {
        if (CLUSTER_ID.every((b, k) => frame[j + k] === b)) {
          clusterCount++
        }
      }
    }
    // frame 0 opens cluster 1, frame 50 opens cluster 2
    expect(clusterCount).toBe(2)
  })
})
