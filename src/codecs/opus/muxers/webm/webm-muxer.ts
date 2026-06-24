/**
 * WebM Muxer for Opus audio
 *
 * Implements minimal WebM container (Matroska subset) for audio-only streams
 * Reference: https://www.webmproject.org/docs/container/
 *
 * Structure:
 * - EBML Header
 * - Segment (unknown size)
 *   - Info (TimestampScale, MuxingApp, WritingApp)
 *   - Tracks
 *     - TrackEntry (Audio track with Opus codec)
 *   - Cluster × N (created every ~1 second)
 *     - Timestamp
 *     - SimpleBlock × N
 */

import {
  writeId,
  writeVint,
  writeUint,
  writeFloat64,
  writeElement,
  concat,
} from "./ebml-writer"

export interface WebmMuxerOptions {
  /** Sample rate (always 48000 for Opus output) */
  sampleRate: number
  /** Number of audio channels (1-8) */
  channels: number
  /** Frame duration in milliseconds (used for documentation only) */
  frameDurationMs?: number
}

// EBML Element IDs (Matroska v4)
const EBML = 0x1a45dfa3
const EBMLVersion = 0x4286
const EBMLReadVersion = 0x42f7
const EBMLMaxIDLength = 0x42f2
const EBMLMaxSizeLength = 0x42f3
const DocType = 0x4282
const DocTypeVersion = 0x4287
const DocTypeReadVersion = 0x4285

const Segment = 0x18538067
const Info = 0x1549a966
const TimestampScale = 0x2ad7b1 // Renamed from TimecodeScale in Matroska v4
const MuxingApp = 0x4d80
const WritingApp = 0x5741

const Tracks = 0x1654ae6b
const TrackEntry = 0xae
const TrackNumber = 0xd7
const TrackUID = 0x73c5
const TrackType = 0x83
const CodecID = 0x86
const CodecPrivate = 0x63a2
const Audio = 0xe1
const SamplingFrequency = 0xb5
const Channels = 0x9f

const Cluster = 0x1f43b675
const Timestamp = 0xe7
const SimpleBlock = 0xa3

// EBML unknown size: 0xFF bytes = all bits set (per EBML spec §7.3)
const UNKNOWN_SIZE_BYTES = new Uint8Array([
  0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
])

export class WebmMuxer {
  private readonly sampleRate: number
  private readonly channels: number
  private readonly trackUID: bigint

  private currentClusterTimestamp: number = 0
  private clusterStarted: boolean = false
  private clusterFrameCount: number = 0

  constructor(options: WebmMuxerOptions) {
    this.sampleRate = options.sampleRate
    this.channels = options.channels
    this.trackUID = this.generateTrackUID()
  }

  /**
   * Generate random track UID
   */
  private generateTrackUID(): bigint {
    return BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
  }

  /**
   * Create EBML Header
   */
  private createEBMLHeader(): Uint8Array {
    const content = concat(
      writeElement(EBMLVersion, writeUint(1)),
      writeElement(EBMLReadVersion, writeUint(1)),
      writeElement(EBMLMaxIDLength, writeUint(4)),
      writeElement(EBMLMaxSizeLength, writeUint(8)),
      writeElement(DocType, new TextEncoder().encode("webm")),
      writeElement(DocTypeVersion, writeUint(2)),
      writeElement(DocTypeReadVersion, writeUint(2))
    )

    return writeElement(EBML, content)
  }

  /**
   * Create OpusHead-like CodecPrivate data
   * Same format as OGG OpusHead but without "OpusHead" signature
   */
  private createCodecPrivate(): Uint8Array {
    const mappingFamily = this.channels > 2 ? 1 : 0
    const preSkip = 312 // Standard Opus pre-skip at 48kHz

    const parts: Uint8Array[] = [
      new TextEncoder().encode("OpusHead"),
      new Uint8Array([0x01]), // version
      new Uint8Array([this.channels]),
      this.writeUint16LE(preSkip),
      this.writeUint32LE(this.sampleRate),
      this.writeUint16LE(0), // output gain
      new Uint8Array([mappingFamily]),
    ]

    // For channels > 2, add stream mapping
    if (mappingFamily === 1) {
      const streamCount = Math.ceil(this.channels / 2)
      const coupledStreamCount = Math.floor(this.channels / 2)
      const channelMapping = Array.from({ length: this.channels }, (_, i) => i)

      parts.push(
        new Uint8Array([streamCount]),
        new Uint8Array([coupledStreamCount]),
        new Uint8Array(channelMapping)
      )
    }

    return concat(...parts)
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
   * Create Info element
   */
  private createInfo(): Uint8Array {
    const content = concat(
      writeElement(TimestampScale, writeUint(1000000)), // 1ms precision
      writeElement(MuxingApp, new TextEncoder().encode("audio-recorder")),
      writeElement(WritingApp, new TextEncoder().encode("audio-recorder"))
    )

    return writeElement(Info, content)
  }

  /**
   * Create Tracks element
   */
  private createTracks(): Uint8Array {
    const audioContent = concat(
      writeElement(SamplingFrequency, writeFloat64(this.sampleRate)),
      writeElement(Channels, writeUint(this.channels))
    )

    const trackEntryContent = concat(
      writeElement(TrackNumber, writeUint(1)),
      writeElement(TrackUID, writeUint(this.trackUID)),
      writeElement(TrackType, writeUint(2)), // 2 = audio
      writeElement(CodecID, new TextEncoder().encode("A_OPUS")),
      writeElement(CodecPrivate, this.createCodecPrivate()),
      writeElement(Audio, audioContent)
    )

    const tracksContent = writeElement(TrackEntry, trackEntryContent)

    return writeElement(Tracks, tracksContent)
  }

  /**
   * Get WebM headers (EBML Header + Segment start + Info + Tracks)
   */
  getHeaders(): Uint8Array {
    const ebmlHeader = this.createEBMLHeader()

    // Segment with unknown size
    const segmentHeader = concat(writeId(Segment), UNKNOWN_SIZE_BYTES)

    const info = this.createInfo()
    const tracks = this.createTracks()

    return concat(ebmlHeader, segmentHeader, info, tracks)
  }

  /**
   * Create SimpleBlock
   * @param trackNumber - Track number (1)
   * @param timecode - Relative timecode (int16, relative to Cluster Timestamp)
   * @param keyframe - Is keyframe (always true for audio)
   * @param data - Frame data
   */
  private createSimpleBlock(
    trackNumber: number,
    timecode: number,
    keyframe: boolean,
    data: Uint8Array
  ): Uint8Array {
    // SimpleBlock format:
    // - Track number (VINT)
    // - Timecode (int16, big-endian, relative to cluster)
    // - Flags (1 byte): bit7=keyframe, bit6=invisible, bit5-4=lacing (00=no lacing)
    // - Frame data

    const trackNumberBytes = writeVint(trackNumber)
    const timecodeBytes = new Uint8Array(2)
    timecodeBytes[0] = (timecode >> 8) & 0xff
    timecodeBytes[1] = timecode & 0xff

    const flags = keyframe ? 0x80 : 0x00 // Keyframe, no lacing

    const blockData = concat(
      trackNumberBytes,
      timecodeBytes,
      new Uint8Array([flags]),
      data
    )

    return writeElement(SimpleBlock, blockData)
  }

  /**
   * Write a frame
   * Automatically manages Cluster boundaries (~1 second or ~50 frames)
   *
   * @param frame - Opus frame data
   * @param timestampMs - Absolute timestamp in milliseconds
   */
  writeFrame(frame: Uint8Array, timestampMs: number): Uint8Array {
    const output: Uint8Array[] = []

    // Start new cluster if needed
    if (!this.clusterStarted || this.clusterFrameCount >= 50) {
      const clusterHeader = concat(
        writeId(Cluster),
        UNKNOWN_SIZE_BYTES,
        writeElement(Timestamp, writeUint(timestampMs))
      )

      output.push(clusterHeader)
      this.currentClusterTimestamp = timestampMs
      this.clusterStarted = true
      this.clusterFrameCount = 0
    }

    // Calculate relative timecode
    const relativeTimecode = timestampMs - this.currentClusterTimestamp

    // Create SimpleBlock
    const simpleBlock = this.createSimpleBlock(1, relativeTimecode, true, frame)
    output.push(simpleBlock)

    this.clusterFrameCount++

    return concat(...output)
  }

  /**
   * Finalize the stream (no-op for streaming WebM)
   */
  finalize(): Uint8Array {
    // For streaming WebM with unknown size, no finalization needed
    return new Uint8Array(0)
  }
}
