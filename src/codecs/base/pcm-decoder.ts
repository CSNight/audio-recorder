import type { StreamingChunkPayload } from "@/plugins/streaming-export"

export const pcmDecoderDefinition = {
  format: "pcm",
  async decode(audioContext: AudioContext, payload: StreamingChunkPayload) {
    const sampleRate = payload.sampleRate || 16000
    const channels = payload.channels || 1
    const int16 = new Int16Array(
      payload.chunk.buffer,
      payload.chunk.byteOffset,
      Math.floor(payload.chunk.byteLength / 2)
    )
    const frameLength = Math.max(1, Math.floor(int16.length / channels))
    const buffer = audioContext.createBuffer(channels, frameLength, sampleRate)

    for (let channel = 0; channel < channels; channel += 1) {
      const output = buffer.getChannelData(channel)
      for (let index = 0; index < frameLength; index += 1) {
        output[index] = (int16[index * channels + channel] ?? 0) / 32768
      }
    }

    return buffer
  },
}
