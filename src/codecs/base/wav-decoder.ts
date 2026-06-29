export interface DecodedWavPcm {
  sampleRate: number
  channels: number
  bitRate: 8 | 16
  planar: Float32Array[]
}

export function decodeWavToFloat32(buffer: ArrayBuffer): DecodedWavPcm {
  const view = new DataView(buffer)
  assertRiffWave(view)

  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitRate: 8 | 16 | 0 = 0
  let dataOffset = -1
  let dataSize = 0

  while (offset + 8 <= view.byteLength) {
    const chunkId = readAscii(view, offset, 4)
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkDataOffset = offset + 8

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new Error("Invalid WAV fmt chunk size.")
      }

      const audioFormat = view.getUint16(chunkDataOffset, true)
      if (audioFormat !== 1) {
        throw new Error(
          `Unsupported WAV format ${audioFormat}. Only PCM is supported.`
        )
      }

      channels = view.getUint16(chunkDataOffset + 2, true)
      sampleRate = view.getUint32(chunkDataOffset + 4, true)
      bitRate = view.getUint16(chunkDataOffset + 14, true) as 8 | 16
      if (
        channels <= 0 ||
        sampleRate <= 0 ||
        (bitRate !== 8 && bitRate !== 16)
      ) {
        throw new Error("Unsupported WAV fmt metadata.")
      }
    } else if (chunkId === "data") {
      dataOffset = chunkDataOffset
      dataSize = chunkSize
      break
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2)
  }

  if (sampleRate <= 0 || channels <= 0 || (bitRate !== 8 && bitRate !== 16)) {
    throw new Error("WAV fmt chunk is missing.")
  }
  if (dataOffset < 0) {
    throw new Error("WAV data chunk is missing.")
  }
  if (dataOffset + dataSize > view.byteLength) {
    throw new Error("WAV data chunk exceeds buffer length.")
  }

  const bytesPerSample = bitRate / 8
  const totalSamples = Math.floor(dataSize / bytesPerSample)
  const frameLength = Math.floor(totalSamples / channels)
  const planar = Array.from(
    { length: channels },
    () => new Float32Array(frameLength)
  )

  if (bitRate === 8) {
    const bytes = new Uint8Array(buffer, dataOffset, frameLength * channels)
    for (let frameIndex = 0; frameIndex < frameLength; frameIndex += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = bytes[frameIndex * channels + channel] ?? 128
        planar[channel]![frameIndex] = (sample - 128) / 128
      }
    }
  } else {
    for (let frameIndex = 0; frameIndex < frameLength; frameIndex += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sampleOffset = dataOffset + (frameIndex * channels + channel) * 2
        const sample = view.getInt16(sampleOffset, true)
        planar[channel]![frameIndex] = sample / 32768
      }
    }
  }

  return {
    sampleRate,
    channels,
    bitRate,
    planar,
  }
}

function assertRiffWave(view: DataView): void {
  if (view.byteLength < 44) {
    throw new Error("Invalid WAV buffer: too small.")
  }
  if (readAscii(view, 0, 4) !== "RIFF" || readAscii(view, 8, 4) !== "WAVE") {
    throw new Error("Invalid WAV header.")
  }
}

function readAscii(view: DataView, offset: number, length: number): string {
  let output = ""
  for (let index = 0; index < length; index += 1) {
    output += String.fromCharCode(view.getUint8(offset + index))
  }
  return output
}

export const wavDecoderDefinition = {
  format: "wav",
  async decode(audioContext: AudioContext, payload: { chunk: Uint8Array }) {
    const decoded = decodeWavToFloat32(payload.chunk.slice().buffer)
    const frameLength = decoded.planar[0]?.length ?? 0
    const buffer = audioContext.createBuffer(
      decoded.channels,
      frameLength,
      decoded.sampleRate
    )

    for (let channel = 0; channel < decoded.channels; channel += 1) {
      const output = buffer.getChannelData(channel)
      output.set(decoded.planar[channel] ?? new Float32Array(frameLength))
    }

    return buffer
  },
}
