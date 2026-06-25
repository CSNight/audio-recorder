/**
 * Opus codec type definitions
 */

export interface OpusEncoderOptions {
  /** Sample rate (only 8000, 12000, 16000, 24000, 48000 are supported by libopus) */
  sampleRate: 8000 | 12000 | 16000 | 24000 | 48000
  /** Number of channels (1-8) */
  channels: number
  /** Bitrate in bits per second (default: 64000, or 'auto'/'max') */
  bitrate?: number | "auto" | "max"
  /** Frame size in samples (default: sampleRate/1000*20) */
  frameSize?: number
  /** Application type (default: 'audio') */
  application?: "audio" | "voip" | "lowdelay"
  /** Complexity (0-10, default: 10) */
  complexity?: number
  /** Variable bitrate (default: true) */
  vbr?: boolean
  /** Forward error correction (default: false) */
  fec?: boolean
  /** Discontinuous transmission (default: false) */
  dtx?: boolean
  /** Expected packet loss percentage (0-100, default: 0) */
  packetLossPercent?: number
}

export interface OpusDecoderOptions {
  /** Sample rate (only 8000, 12000, 16000, 24000, 48000 are supported by libopus) */
  sampleRate: 8000 | 12000 | 16000 | 24000 | 48000
  /** Number of channels (1-8) */
  channels: number
}

export interface OpusExportOptions {
  /** Container format (default: 'ogg') */
  container?: "ogg" | "webm"
  /** Pre-skip samples at 48kHz (default: 312) */
  preSkip?: number
  /** Bitrate in bits per second (default: 128000) */
  bitrate?: number
  /** Application type (default: 'audio') */
  application?: "audio" | "voip" | "lowdelay"
  /** Complexity (0-10, default: 10) */
  complexity?: number
  /** Variable bitrate (default: true) */
  vbr?: boolean
  /** Forward error correction (default: false) */
  fec?: boolean
  /** Discontinuous transmission (default: false) */
  dtx?: boolean
  /** Expected packet loss percentage (0-100, default: 0) */
  packetLossPercent?: number
}

export interface OpusExportResult {
  data: Uint8Array
  mimeType: string
  sampleRate: number
  channels: number
}

/**
 * Opus encoder handle (returned by createOpusEncoder)
 */
export interface OpusEncoderHandle {
  readonly sampleRate: number
  readonly channels: number
  readonly frameSize: number

  /**
   * Get encoder lookahead in samples at the encoder's sample rate.
   * This equals the pre-skip at 48kHz when sampleRate == 48000, but must be
   * scaled for other rates. Use this to set the correct pre_skip in OGG headers.
   */
  getLookahead(): number

  /**
   * Encode Int16 PCM data
   * @param pcm - Int16Array with frameSize * channels samples
   * @returns Encoded Opus packet
   */
  encode(pcm: Int16Array, opts?: { frameSize?: number }): Uint8Array

  /**
   * Encode Float32 PCM data
   * @param pcm - Float32Array with frameSize * channels samples (range: -1.0 to 1.0)
   * @returns Encoded Opus packet
   */
  encodeFloat(pcm: Float32Array, opts?: { frameSize?: number }): Uint8Array

  /**
   * Free encoder resources
   */
  free(): void
}

/**
 * Opus decoder handle (returned by createOpusDecoder)
 */
export interface OpusDecoderHandle {
  /**
   * Decode Opus packet to Int16 PCM
   * @param packet - Opus packet data
   * @param frameSize - Expected frame size in samples
   * @returns Decoded PCM data
   */
  decode(packet: Uint8Array, frameSize: number): Int16Array

  /**
   * Decode Opus packet to Float32 PCM
   * @param packet - Opus packet data
   * @param frameSize - Expected frame size in samples
   * @returns Decoded PCM data (range: -1.0 to 1.0)
   */
  decodeFloat(packet: Uint8Array, frameSize: number): Float32Array

  /**
   * Decode packet loss (PLC - Packet Loss Concealment)
   * @param frameSize - Expected frame size in samples
   * @returns Decoded PCM data with PLC
   */
  decodePacketLoss(frameSize: number): Int16Array

  /**
   * Free decoder resources
   */
  free(): void
}

/**
 * Opus error codes
 */
export enum OpusErrorCode {
  OK = 0,
  BadArg = -1,
  BufferTooSmall = -2,
  InternalError = -3,
  InvalidPacket = -4,
  Unimplemented = -5,
  InvalidState = -6,
  AllocFail = -7,
}

/**
 * Opus error class
 */
export class OpusError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly codeName: string,
    public readonly operation: string
  ) {
    super(`${operation}: ${message} (${codeName})`)
    this.name = "OpusError"
  }
}
