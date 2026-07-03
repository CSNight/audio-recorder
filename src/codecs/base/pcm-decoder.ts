import type {
  AudioDecoderDefinition,
  DecodedAudioChunk,
  EncodedAudioChunk,
} from "../../types"

export const pcmDecoderDefinition: AudioDecoderDefinition = {
  format: "pcm",
  async decode(chunk: EncodedAudioChunk): Promise<DecodedAudioChunk> {
    const sampleRate = chunk.sampleRate || 16000
    const channels = chunk.channels || 1
    const int16 = new Int16Array(
      chunk.chunk.buffer,
      chunk.chunk.byteOffset,
      Math.floor(chunk.chunk.byteLength / 2)
    )
    const frameLength = Math.max(1, Math.floor(int16.length / channels))
    const planar = Array.from(
      { length: channels },
      () => new Float32Array(frameLength)
    )

    for (let channel = 0; channel < channels; channel += 1) {
      const output = planar[channel]!
      for (let index = 0; index < frameLength; index += 1) {
        output[index] = (int16[index * channels + channel] ?? 0) / 32768
      }
    }

    return {
      sampleRate,
      channels,
      planar,
    }
  },
}
