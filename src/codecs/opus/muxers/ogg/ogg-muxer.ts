/**
 * OGG Muxer for Opus audio
 *
 * Implements RFC 3533 (OGG) and RFC 7845 (Opus in OGG)
 *
 * OGG Page structure:
 * - capture_pattern: "OggS" (4 bytes)
 * - stream_structure_version: 0x00 (1 byte)
 * - header_type_flag: bits for continued/bos/eos (1 byte)
 * - absolute_granule_position: int64 LE (8 bytes)
 * - stream_serial_number: uint32 LE (4 bytes)
 * - page_sequence_number: uint32 LE (4 bytes)
 * - checksum: CRC32 (4 bytes)
 * - page_segments: segment count (1 byte)
 * - segment_table: byte counts (N bytes)
 * - page_body: actual data (M bytes)
 */

import { calculateOggCrc32 } from "./ogg-crc32"

export interface OggMuxerOptions {
  /** Sample rate (used for info only, granule is always at 48kHz) */
  sampleRate: number
  /** Number of audio channels (1-8) */
  channels: number
  /** Pre-skip samples at 48kHz (default: 312) */
  preSkip?: number
  /** Stream serial number (default: random uint32) */
  serialNumber?: number
}

const CAPTURE_PATTERN = new TextEncoder().encode("OggS")
const OPUS_HEAD_SIGNATURE = new TextEncoder().encode("OpusHead")
const OPUS_TAGS_SIGNATURE = new TextEncoder().encode("OpusTags")
const VENDOR_STRING = new TextEncoder().encode("audio-recorder")

// Header type flags
const FLAG_BOS = 0x02 // Beginning of stream
const FLAG_EOS = 0x04 // End of stream

// Vorbis channel mapping (used for mapping_family=1)
const VORBIS_CHANNEL_ORDER = [0, 1, 2, 3, 4, 5, 6, 7]

export class OggMuxer {
  private readonly sampleRate: number
  private readonly channels: number
  private readonly preSkip: number
  private readonly serialNumber: number
  private pageSequenceNumber: number = 0

  constructor(options: OggMuxerOptions) {
    this.sampleRate = options.sampleRate
    this.channels = options.channels
    this.preSkip = options.preSkip ?? 312
    this.serialNumber = options.serialNumber ?? this.generateSerialNumber()
  }

  /**
   * Get header pages (ID Header + Comment Header)
   */
  getHeaderPages(): Uint8Array {
    // ID Header page (BOS flag, granule=0, sequence=0)
    const opusHead = this.createOpusHead()
    const idHeaderSegmentTable = this.buildSegmentTable(opusHead.length)
    const idHeaderPage = this.buildPage(
      FLAG_BOS,
      0n,
      idHeaderSegmentTable,
      opusHead
    )

    // Comment Header page (granule=0, sequence=1)
    const opusTags = this.createOpusTags()
    const commentHeaderSegmentTable = this.buildSegmentTable(opusTags.length)
    const commentHeaderPage = this.buildPage(
      0,
      0n,
      commentHeaderSegmentTable,
      opusTags
    )

    return this.concat(idHeaderPage, commentHeaderPage)
  }

  /**
   * Write a data frame
   * @param frame - Opus frame data
   * @param granulePosition - Absolute granule position (at 48kHz)
   */
  writeFrame(frame: Uint8Array, granulePosition: bigint): Uint8Array {
    const segmentTable = this.buildSegmentTable(frame.length)
    return this.buildPage(0, granulePosition, segmentTable, frame)
  }

  /**
   * Write final frame with EOS flag
   * @param frame - Opus frame data
   * @param granulePosition - Absolute granule position (at 48kHz)
   */
  writeFinalFrame(frame: Uint8Array, granulePosition: bigint): Uint8Array {
    const segmentTable = this.buildSegmentTable(frame.length)
    return this.buildPage(FLAG_EOS, granulePosition, segmentTable, frame)
  }

  /**
   * Generate random serial number
   */
  private generateSerialNumber(): number {
    return Math.floor(Math.random() * 0xffffffff) >>> 0
  }

  /**
   * Write uint16 little-endian
   */
  private writeUint16LE(value: number): Uint8Array {
    const buf = new Uint8Array(2)
    buf[0] = value & 0xff
    buf[1] = (value >>> 8) & 0xff
    return buf
  }

  /**
   * Write uint32 little-endian
   */
  private writeUint32LE(value: number): Uint8Array {
    const buf = new Uint8Array(4)
    buf[0] = value & 0xff
    buf[1] = (value >>> 8) & 0xff
    buf[2] = (value >>> 16) & 0xff
    buf[3] = (value >>> 24) & 0xff
    return buf
  }

  /**
   * Write int64 little-endian (as bigint)
   */
  private writeInt64LE(value: bigint): Uint8Array {
    const buf = new Uint8Array(8)
    let v = value
    for (let i = 0; i < 8; i++) {
      buf[i] = Number(v & 0xffn)
      v = v >> 8n
    }
    return buf
  }

  /**
   * Concatenate Uint8Arrays
   */
  private concat(...arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const arr of arrays) {
      result.set(arr, offset)
      offset += arr.length
    }
    return result
  }

  /**
   * Build segment table for a packet
   */
  private buildSegmentTable(packetSize: number): Uint8Array {
    const segments: number[] = []
    let remaining = packetSize

    while (remaining >= 255) {
      segments.push(255)
      remaining -= 255
    }
    segments.push(remaining)

    return new Uint8Array(segments)
  }

  /**
   * Build OGG page
   */
  private buildPage(
    headerTypeFlag: number,
    granulePosition: bigint,
    segmentTable: Uint8Array,
    pageBody: Uint8Array
  ): Uint8Array {
    const header = this.concat(
      CAPTURE_PATTERN, // "OggS"
      new Uint8Array([0x00]), // version
      new Uint8Array([headerTypeFlag]),
      this.writeInt64LE(granulePosition),
      this.writeUint32LE(this.serialNumber),
      this.writeUint32LE(this.pageSequenceNumber++),
      new Uint8Array([0, 0, 0, 0]), // checksum placeholder
      new Uint8Array([segmentTable.length]),
      segmentTable
    )

    const page = this.concat(header, pageBody)

    // Calculate CRC32 with checksum field at zero
    const checksumOffset = 22
    const crc = calculateOggCrc32(page, 0)

    // Write checksum into the page
    page[checksumOffset] = crc & 0xff
    page[checksumOffset + 1] = (crc >>> 8) & 0xff
    page[checksumOffset + 2] = (crc >>> 16) & 0xff
    page[checksumOffset + 3] = (crc >>> 24) & 0xff

    return page
  }

  /**
   * Create OpusHead packet (ID Header)
   */
  private createOpusHead(): Uint8Array {
    const mappingFamily = this.channels > 2 ? 1 : 0
    const parts: Uint8Array[] = [
      OPUS_HEAD_SIGNATURE, // "OpusHead"
      new Uint8Array([0x01]), // version
      new Uint8Array([this.channels]),
      this.writeUint16LE(this.preSkip),
      this.writeUint32LE(this.sampleRate), // input sample rate (informational)
      this.writeUint16LE(0), // output gain (0 dB)
      new Uint8Array([mappingFamily]),
    ]

    // For mapping_family=1 (channels > 2), add stream mapping
    if (mappingFamily === 1) {
      const streamCount = Math.ceil(this.channels / 2)
      const coupledStreamCount = Math.floor(this.channels / 2)
      const channelMapping = VORBIS_CHANNEL_ORDER.slice(0, this.channels)

      parts.push(
        new Uint8Array([streamCount]),
        new Uint8Array([coupledStreamCount]),
        new Uint8Array(channelMapping)
      )
    }

    return this.concat(...parts)
  }

  /**
   * Create OpusTags packet (Comment Header)
   */
  private createOpusTags(): Uint8Array {
    return this.concat(
      OPUS_TAGS_SIGNATURE, // "OpusTags"
      this.writeUint32LE(VENDOR_STRING.length),
      VENDOR_STRING,
      this.writeUint32LE(0) // user comment list length (empty)
    )
  }
}
