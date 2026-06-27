import type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
} from "@/plugins/streaming-export/types"
import type { PcmBufferSnapshot } from "@/buffer/types"
import { resample } from "audio-recorder"
import { createAacEncoder, preloadAacModule } from "./aac-wasm-api"
import type { AacEncoderHandle, AacEncoderOptions } from "./types"

export type AacChunkedEncoderOptions = Partial<AacEncoderOptions>

function createFrameSnapshot(
  channels: number,
  sampleRate: number,
  planar: Int16Array[]
): PcmBufferSnapshot {
  const frameLength = planar[0]?.length ?? 0
  return {
    sampleRate,
    channels,
    frameCount: 1,
    durationMs: frameLength === 0 ? 0 : (frameLength / sampleRate) * 1000,
    planar,
  }
}

function appendChannel(target: Int16Array, incoming: Int16Array): Int16Array {
  if (target.length === 0) {
    return new Int16Array(incoming)
  }

  const merged = new Int16Array(target.length + incoming.length)
  merged.set(target)
  merged.set(incoming, target.length)
  return merged
}

function appendPlanar(
  buffered: Int16Array[],
  incoming: Int16Array[],
  channels: number
): Int16Array[] {
  if (buffered.length === 0) {
    return incoming.map((channel) => new Int16Array(channel))
  }

  return Array.from({ length: channels }, (_, index) =>
    appendChannel(
      buffered[index] ?? new Int16Array(0),
      incoming[index] ?? new Int16Array(0)
    )
  )
}

function interleave(planar: Int16Array[], channels: number, frameSize: number) {
  const interleaved = new Int16Array(frameSize * channels)

  for (let i = 0; i < frameSize; i++) {
    for (let channel = 0; channel < channels; channel++) {
      interleaved[i * channels + channel] = planar[channel]?.[i] ?? 0
    }
  }

  return interleaved
}

function parseAudioSpecificConfig(audioSpecificConfig: Uint8Array) {
  const audioObjectType = (audioSpecificConfig[0]! >> 3) & 0x1f
  const samplingFrequencyIndex =
    ((audioSpecificConfig[0]! & 0x07) << 1) | (audioSpecificConfig[1]! >> 7)
  const channelConfiguration = (audioSpecificConfig[1]! >> 3) & 0x0f

  return {
    audioObjectType,
    samplingFrequencyIndex,
    channelConfiguration,
  }
}

function wrapAdtsFrame(
  payload: Uint8Array,
  audioSpecificConfig: Uint8Array
): Uint8Array {
  const config = parseAudioSpecificConfig(audioSpecificConfig)
  const profile = Math.max(0, Math.min(3, config.audioObjectType - 1))
  const frameLength = payload.byteLength + 7

  const header = new Uint8Array(7)
  header[0] = 0xff
  header[1] = 0xf1
  header[2] =
    (profile << 6) |
    ((config.samplingFrequencyIndex & 0x0f) << 2) |
    ((config.channelConfiguration >> 2) & 0x01)
  header[3] =
    ((config.channelConfiguration & 0x03) << 6) | ((frameLength >> 11) & 0x03)
  header[4] = (frameLength >> 3) & 0xff
  header[5] = ((frameLength & 0x07) << 5) | 0x1f
  header[6] = 0xfc

  const frame = new Uint8Array(frameLength)
  frame.set(header)
  frame.set(payload, header.length)
  return frame
}

function concatChunks(chunks: Uint8Array[]): Uint8Array | null {
  if (chunks.length === 0) {
    return null
  }

  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(totalSize)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return merged
}

function createAacChunkedEncoder(
  options: AacChunkedEncoderOptions = {}
): ChunkedEncoder {
  let encoder: AacEncoderHandle | null = null
  let bufferedPlanar: Int16Array[] = []
  let encoderChannels = 0
  let encoderSampleRate = 0

  const getOrCreateEncoder = (channels: number, sampleRate: number) => {
    if (encoder) {
      return encoder
    }

    const encoderOptions: AacEncoderOptions = {
      channels,
      sampleRate,
    }
    if (options.bitrate !== undefined) {
      encoderOptions.bitrate = options.bitrate
    }

    encoder = createAacEncoder(encoderOptions)
    encoderChannels = channels
    encoderSampleRate = sampleRate
    return encoder
  }

  const normalizeFrame = (
    channels: number,
    sampleRate: number,
    planar: Int16Array[]
  ) => {
    const targetSampleRate = options.sampleRate ?? sampleRate
    const snapshot = createFrameSnapshot(channels, sampleRate, planar)
    return targetSampleRate === sampleRate
      ? snapshot
      : resample(snapshot, targetSampleRate, {})
  }

  return {
    feedFrame(channels, sampleRate, planar) {
      const normalized = normalizeFrame(channels, sampleRate, planar)
      const frameLength = normalized.planar[0]?.length ?? 0
      if (frameLength === 0) {
        return null
      }

      const liveEncoder = getOrCreateEncoder(
        normalized.channels,
        normalized.sampleRate
      )

      if (
        encoderChannels !== normalized.channels ||
        encoderSampleRate !== normalized.sampleRate
      ) {
        throw new Error(
          "AAC chunked encoder does not support mid-stream format changes."
        )
      }

      bufferedPlanar = appendPlanar(
        bufferedPlanar,
        normalized.planar,
        normalized.channels
      )

      const chunks: Uint8Array[] = []
      while ((bufferedPlanar[0]?.length ?? 0) >= liveEncoder.frameSize) {
        const framePlanar = bufferedPlanar.map((channel) =>
          channel.subarray(0, liveEncoder.frameSize)
        )
        const interleaved = interleave(
          framePlanar,
          normalized.channels,
          liveEncoder.frameSize
        )

        for (const packet of liveEncoder.encode(interleaved)) {
          chunks.push(wrapAdtsFrame(packet, liveEncoder.audioSpecificConfig))
        }

        bufferedPlanar = bufferedPlanar.map((channel) =>
          channel.subarray(liveEncoder.frameSize)
        )
      }

      return concatChunks(chunks)
    },

    flush() {
      if (!encoder) {
        return null
      }

      const chunks: Uint8Array[] = []
      const bufferedSamples = bufferedPlanar[0]?.length ?? 0

      if (bufferedSamples > 0) {
        const paddedPlanar = bufferedPlanar.map((channel) => {
          const padded = new Int16Array(encoder!.frameSize)
          padded.set(channel.subarray(0, encoder!.frameSize))
          return padded
        })

        const interleaved = interleave(
          paddedPlanar,
          encoderChannels,
          encoder.frameSize
        )
        for (const packet of encoder.encode(interleaved)) {
          chunks.push(wrapAdtsFrame(packet, encoder.audioSpecificConfig))
        }
      }

      for (const packet of encoder.flush()) {
        chunks.push(wrapAdtsFrame(packet, encoder.audioSpecificConfig))
      }

      bufferedPlanar = []
      return concatChunks(chunks)
    },

    dispose() {
      bufferedPlanar = []
      encoder?.free()
      encoder = null
      encoderChannels = 0
      encoderSampleRate = 0
    },
  }
}

export const aacChunkedEncoderDefinition: ChunkedEncoderDefinition<AacChunkedEncoderOptions> =
  {
    format: "aac",
    preload: preloadAacModule,
    create: createAacChunkedEncoder,
  }
