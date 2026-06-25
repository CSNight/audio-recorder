import { describe, expect, it } from "vitest"
import {
  writeVint,
  writeUint,
  writeInt,
  writeFloat64,
  writeId,
  writeElement,
  concat,
} from "@/codecs/opus/muxers/webm/ebml-writer"

// ---- writeVint ---------------------------------------------------------------

describe("writeVint", () => {
  it("encodes value 1 as single byte 0x81", () => {
    expect(Array.from(writeVint(1))).toEqual([0x81])
  })

  it("encodes value 127 (max 1-byte) as 0xFF", () => {
    // 0x7F | 0x80 = 0xFF
    expect(Array.from(writeVint(127))).toEqual([0xff])
  })

  it("encodes value 128 as 2 bytes (0x40, 0x80)", () => {
    // 2-byte VINT: marker bit at bit 14
    expect(Array.from(writeVint(128))).toEqual([0x40, 0x80])
  })

  it("encodes value 0 as single byte 0x80", () => {
    expect(Array.from(writeVint(0))).toEqual([0x80])
  })

  it("encodes value 16383 (max 2-byte VINT) as 2 bytes 0x7F 0xFF", () => {
    expect(Array.from(writeVint(16383))).toEqual([0x7f, 0xff])
  })

  it("3-byte VINT: value 16384 encodes to 3 bytes", () => {
    const result = writeVint(16384)
    expect(result.length).toBe(3)
    expect(result[0]).toBe(0x20) // 0b00100000
  })

  it("VINT value is round-trippable: strip marker bit and recover value", () => {
    // For 1-byte VINT: value = byte & 0x7F
    const encoded = writeVint(100)
    expect(encoded.length).toBe(1)
    expect(encoded[0]! & 0x7f).toBe(100)
  })
})

// ---- writeUint ---------------------------------------------------------------

describe("writeUint (number)", () => {
  it("encodes 0 as single byte 0x00", () => {
    expect(Array.from(writeUint(0))).toEqual([0x00])
  })

  it("encodes 1 as single byte 0x01", () => {
    expect(Array.from(writeUint(1))).toEqual([0x01])
  })

  it("encodes 255 as single byte 0xFF", () => {
    expect(Array.from(writeUint(255))).toEqual([0xff])
  })

  it("encodes 256 as 2 bytes big-endian", () => {
    expect(Array.from(writeUint(256))).toEqual([0x01, 0x00])
  })

  it("encodes 1000000 (TimestampScale) correctly", () => {
    // 1000000 = 0x0F4240
    expect(Array.from(writeUint(1000000))).toEqual([0x0f, 0x42, 0x40])
  })

  it("encodes bigint 0n as single byte 0x00", () => {
    expect(Array.from(writeUint(0n))).toEqual([0x00])
  })

  it("encodes bigint larger than MAX_SAFE_INTEGER in 8 bytes", () => {
    const big = 0x0102030405060708n
    const result = writeUint(big)
    expect(result.length).toBe(8)
    expect(result[0]).toBe(0x01)
    expect(result[7]).toBe(0x08)
  })
})

// ---- writeInt ----------------------------------------------------------------

describe("writeInt", () => {
  it("encodes 0 as single byte 0x00", () => {
    expect(Array.from(writeInt(0))).toEqual([0x00])
  })

  it("encodes 127 (max positive 1-byte) as 0x7F", () => {
    expect(Array.from(writeInt(127))).toEqual([0x7f])
  })

  it("encodes -128 (min negative 1-byte) as 0x80", () => {
    expect(Array.from(writeInt(-128))).toEqual([0x80])
  })

  it("encodes 128 as 2 bytes (needs sign extension)", () => {
    expect(Array.from(writeInt(128))).toEqual([0x00, 0x80])
  })

  it("encodes -1 as single byte 0xFF (two's complement)", () => {
    expect(Array.from(writeInt(-1))).toEqual([0xff])
  })

  it("encodes -129 as 2 bytes", () => {
    expect(Array.from(writeInt(-129))).toEqual([0xff, 0x7f])
  })
})

// ---- writeFloat64 ------------------------------------------------------------

describe("writeFloat64", () => {
  it("encodes 0.0 as 8 zero bytes", () => {
    expect(Array.from(writeFloat64(0.0))).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it("encodes 48000.0 correctly (big-endian IEEE 754)", () => {
    const result = writeFloat64(48000.0)
    expect(result.length).toBe(8)
    // Verify round-trip via DataView
    const view = new DataView(result.buffer, result.byteOffset, 8)
    expect(view.getFloat64(0, false)).toBe(48000.0)
  })

  it("encodes 44100.0 correctly", () => {
    const result = writeFloat64(44100.0)
    const view = new DataView(result.buffer, result.byteOffset, 8)
    expect(view.getFloat64(0, false)).toBe(44100.0)
  })

  it("encodes 1.0 with correct IEEE 754 big-endian bytes", () => {
    // 1.0 = 0x3FF0000000000000
    const result = writeFloat64(1.0)
    expect(result[0]).toBe(0x3f)
    expect(result[1]).toBe(0xf0)
    expect(result.slice(2).every((b) => b === 0)).toBe(true)
  })

  it("48000 and 44100 produce different byte sequences", () => {
    const a = writeFloat64(48000)
    const b = writeFloat64(44100)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })
})

// ---- writeId -----------------------------------------------------------------

describe("writeId", () => {
  it("encodes 1-byte ID 0x86 (CodecID) as single byte", () => {
    expect(Array.from(writeId(0x86))).toEqual([0x86])
  })

  it("encodes 2-byte ID 0x4286 (EBMLVersion) as 2 bytes big-endian", () => {
    expect(Array.from(writeId(0x4286))).toEqual([0x42, 0x86])
  })

  it("encodes 3-byte ID 0x2ad7b1 (TimestampScale) as 3 bytes", () => {
    expect(Array.from(writeId(0x2ad7b1))).toEqual([0x2a, 0xd7, 0xb1])
  })

  it("encodes 4-byte ID 0x1a45dfa3 (EBML) as 4 bytes big-endian", () => {
    expect(Array.from(writeId(0x1a45dfa3))).toEqual([0x1a, 0x45, 0xdf, 0xa3])
  })

  it("encodes 4-byte Segment ID 0x18538067 as 4 bytes", () => {
    expect(Array.from(writeId(0x18538067))).toEqual([0x18, 0x53, 0x80, 0x67])
  })
})

// ---- writeElement ------------------------------------------------------------

describe("writeElement", () => {
  it("writes element = ID bytes + VINT size + data", () => {
    // ID=0x86 (1 byte), data=[0x41, 0x5f, 0x4f, 0x50, 0x55, 0x53] = "A_OPUS" (6 bytes)
    const data = new TextEncoder().encode("A_OPUS")
    const elem = writeElement(0x86, data)
    // [0x86, 0x86 (VINT for 6), ...data]
    expect(elem[0]).toBe(0x86) // ID
    expect(elem[1]).toBe(0x86) // VINT(6) = 0x80 | 6
    expect(elem.length).toBe(1 + 1 + 6)
    expect(Array.from(elem.slice(2))).toEqual(Array.from(data))
  })

  it("writes element with empty data (size VINT = 0x80)", () => {
    const elem = writeElement(0x86, new Uint8Array(0))
    expect(elem[0]).toBe(0x86)
    expect(elem[1]).toBe(0x80) // VINT(0)
    expect(elem.length).toBe(2)
  })

  it("4-byte ID element has correct structure", () => {
    const data = new Uint8Array([1, 2, 3])
    const elem = writeElement(0x1a45dfa3, data)
    // 4 ID bytes + 1 VINT byte + 3 data bytes = 8
    expect(elem.length).toBe(8)
    expect(Array.from(elem.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3])
  })

  it("nested elements: outer size equals sum of inner bytes", () => {
    const inner1 = writeElement(0x86, new Uint8Array([0x01]))
    const inner2 = writeElement(0x9f, new Uint8Array([0x02]))
    const outer = writeElement(0xe1, concat(inner1, inner2))
    // outer = [ID(1)] + [VINT(inner1.len+inner2.len)] + [inner1] + [inner2]
    const dataSize = inner1.length + inner2.length
    expect(outer.length).toBe(1 + 1 + dataSize)
  })
})

// ---- concat ------------------------------------------------------------------

describe("concat", () => {
  it("concatenates two arrays correctly", () => {
    const a = new Uint8Array([1, 2])
    const b = new Uint8Array([3, 4])
    expect(Array.from(concat(a, b))).toEqual([1, 2, 3, 4])
  })

  it("handles empty arrays", () => {
    const a = new Uint8Array([1])
    const empty = new Uint8Array(0)
    expect(Array.from(concat(empty, a, empty))).toEqual([1])
  })

  it("result is a fresh Uint8Array (mutation of original does not affect result)", () => {
    const a = new Uint8Array([1, 2])
    const result = concat(a)
    a[0] = 99
    expect(result[0]).toBe(1) // not 99
  })
})
