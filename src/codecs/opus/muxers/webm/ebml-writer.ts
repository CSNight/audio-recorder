/**
 * EBML (Extensible Binary Meta Language) writer utilities
 *
 * Used for WebM container format
 * Reference: https://www.matroska.org/technical/specs/index.html
 */

/**
 * Write EBML variable-length integer (VINT)
 * Format: first byte has leading 1 bit indicating length, followed by data
 *
 * Examples:
 * - 0x81 = 1 (1 byte: 10000001)
 * - 0x4001 = 1 (2 bytes: 01000000 00000001)
 */
export function writeVint(value: number): Uint8Array {
  // Determine required bytes
  let bytes = 1
  let max = 0x7f // (2^7 - 1)

  while (value > max && bytes < 8) {
    bytes++
    max = (max << 7) | 0x7f
  }

  const result = new Uint8Array(bytes)

  // Set length marker (leading 1 bit)
  result[0] = (1 << (8 - bytes)) | (value >> ((bytes - 1) * 8))

  // Write remaining bytes
  for (let i = 1; i < bytes; i++) {
    result[i] = (value >> ((bytes - 1 - i) * 8)) & 0xff
  }

  return result
}

/**
 * Write unsigned integer in minimum bytes (big-endian)
 */
export function writeUint(value: number | bigint): Uint8Array {
  const v = typeof value === "bigint" ? value : BigInt(value)

  if (v === 0n) {
    return new Uint8Array([0])
  }

  // Determine required bytes
  let bytes = 1
  let max = 0xffn
  while (v > max && bytes < 8) {
    bytes++
    max = (max << 8n) | 0xffn
  }

  const result = new Uint8Array(bytes)
  for (let i = 0; i < bytes; i++) {
    result[bytes - 1 - i] = Number((v >> BigInt(i * 8)) & 0xffn)
  }

  return result
}

/**
 * Write signed integer in minimum bytes (big-endian, two's complement)
 */
export function writeInt(value: number): Uint8Array {
  if (value === 0) {
    return new Uint8Array([0])
  }

  // Determine required bytes
  let bytes = 1
  let min = -128
  let max = 127

  while ((value < min || value > max) && bytes < 8) {
    bytes++
    min = -(1 << (bytes * 8 - 1))
    max = (1 << (bytes * 8 - 1)) - 1
  }

  const result = new Uint8Array(bytes)
  let v = value < 0 ? Math.pow(2, bytes * 8) + value : value

  for (let i = 0; i < bytes; i++) {
    result[bytes - 1 - i] = v & 0xff
    v = v >> 8
  }

  return result
}

/**
 * Write float64 (big-endian, IEEE 754)
 */
export function writeFloat64(value: number): Uint8Array {
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)
  view.setFloat64(0, value, false) // big-endian
  return new Uint8Array(buffer)
}

/**
 * Write EBML element ID as raw big-endian bytes.
 * Unlike data VINTs, element IDs already carry their length marker bits and
 * must be written verbatim — NOT re-encoded through writeVint.
 */
export function writeId(id: number): Uint8Array {
  if (id <= 0xff) return new Uint8Array([id])
  if (id <= 0xffff) return new Uint8Array([id >>> 8, id & 0xff])
  if (id <= 0xffffff)
    return new Uint8Array([id >>> 16, (id >>> 8) & 0xff, id & 0xff])
  return new Uint8Array([
    (id >>> 24) & 0xff,
    (id >>> 16) & 0xff,
    (id >>> 8) & 0xff,
    id & 0xff,
  ])
}

/**
 * Write EBML element with ID and size
 * @param id - Element ID (raw EBML ID value, e.g. 0x86 for CodecID)
 * @param data - Element data
 */
export function writeElement(id: number, data: Uint8Array): Uint8Array {
  const idBytes = writeId(id)
  const sizeBytes = writeVint(data.length)

  const result = new Uint8Array(idBytes.length + sizeBytes.length + data.length)
  result.set(idBytes, 0)
  result.set(sizeBytes, idBytes.length)
  result.set(data, idBytes.length + sizeBytes.length)

  return result
}

/**
 * Concatenate multiple Uint8Arrays
 */
export function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}
