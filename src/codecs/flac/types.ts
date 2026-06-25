/**
 * FLAC codec type definitions
 */

export interface FlacEncoderOptions {
  /** Sample rate */
  sampleRate: number
  /** Number of channels (1-8, libflac native support) */
  channels: number
  /** Bits per sample (8, 12, 16, 20, 24, 32 - RFC 9639 streamable subset) */
  bitsPerSample?: 8 | 12 | 16 | 20 | 24 | 32
  /** Compression level (0-8, default: 5) */
  compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  /** Total samples estimate (optional, helps FLAC optimize STREAMINFO) */
  totalSamplesEstimate?: number
}

export interface FlacExportOptions {
  /** Bits per sample (default: 16) */
  bitsPerSample?: 8 | 12 | 16 | 20 | 24 | 32
  /** Compression level (default: 5) */
  compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

export interface FlacExportResult {
  data: Uint8Array
  mimeType: string
  sampleRate: number
  channels: number
  bitsPerSample: number
}

/**
 * FLAC encoder handle (returned by createFlacEncoder)
 */
export interface FlacEncoderHandle {
  readonly sampleRate: number
  readonly channels: number
  readonly bitsPerSample: number

  /**
   * Encode interleaved PCM data
   * @param pcm - Int16Array with samples * channels samples (interleaved)
   * @param samplesPerChannel - Number of samples per channel
   * @returns Encoded FLAC frame bytes
   */
  encode(pcm: Int16Array, samplesPerChannel: number): Uint8Array

  /**
   * Flush remaining data and finalize stream
   * @returns Final FLAC bytes (including updated STREAMINFO)
   */
  flush(): Uint8Array

  /**
   * Free encoder resources
   */
  free(): void

}

/**
 * FLAC error class
 */
export class FlacError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly operation: string
  ) {
    super(`${operation}: ${message}`)
    this.name = "FlacError"
  }
}
