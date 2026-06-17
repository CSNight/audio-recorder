/** Type declarations for vendored lame.all.js (self-contained IIFE bundle). */

export interface Mp3Encoder {
  encodeBuffer(left: Int16Array, right: Int16Array): Int8Array
  flush(): Int8Array
}

export interface Mp3EncoderConstructor {
  new (channels: number, sampleRate: number, kbps: number): Mp3Encoder
}

export declare const Mp3Encoder: Mp3EncoderConstructor
export declare const WavHeader: unknown
