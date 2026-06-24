/**
 * OGG CRC32 implementation
 *
 * OGG uses polynomial 0x04c11db7 (non-reflected, MSB-first)
 * Different from zlib's 0xEDB88320 (reflected)
 *
 * Initial seed: 0 (not 0xFFFFFFFF like zlib)
 * Reference: RFC 3533
 */

// Pre-computed CRC32 lookup table for OGG polynomial
const CRC_TABLE = new Uint32Array(256)

// Initialize lookup table
function initCrcTable() {
  const poly = 0x04c11db7

  for (let i = 0; i < 256; i++) {
    let crc = i << 24

    for (let j = 0; j < 8; j++) {
      if (crc & 0x80000000) {
        crc = (crc << 1) ^ poly
      } else {
        crc = crc << 1
      }
    }

    CRC_TABLE[i] = crc >>> 0 // Ensure unsigned 32-bit
  }
}

// Initialize table on module load
initCrcTable()

/**
 * Calculate OGG CRC32 for a byte array
 * @param data - Input data
 * @param seed - Initial CRC value (default: 0)
 * @returns CRC32 checksum (unsigned 32-bit)
 */
export function calculateOggCrc32(data: Uint8Array, seed: number = 0): number {
  let crc = seed >>> 0

  for (let i = 0; i < data.length; i++) {
    const index = ((crc >>> 24) ^ data[i]!) & 0xff
    crc = ((crc << 8) ^ CRC_TABLE[index]!) >>> 0
  }

  return crc
}
