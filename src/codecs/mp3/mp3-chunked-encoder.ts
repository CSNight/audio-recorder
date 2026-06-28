/**
 * MP3 ???chunked???????
 *
 * ????????????
 * 1. MP3 ?? Worker blob ???mp3-worker.ts ? import?
 * 2. Worker ???????? fallback ???chunked-encoder-bridge.ts ? import?
 *
 * ??????src/index.ts??????????? MP3 WASM ??? bundle?
 */
import type { PcmBufferSnapshot } from "@/buffer/types"
import type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
} from "@/plugins/streaming-export/types"
import { resample } from "audio-recorder"
import {
  createMp3Encoder,
  preloadMp3Module,
  resolveMp3EncoderOptions,
} from "./mp3-wasm-api"
import type {
  Mp3EncoderOptions,
  Mp3WasmEncoderHandle,
  ResolvedMp3EncoderOptions,
} from "./types"

export type Mp3ChunkedEncoderOptions = Mp3EncoderOptions

type NormalizedFrame = {
  channels: 1 | 2
  sampleRate: ResolvedMp3EncoderOptions["sampleRate"]
  planar: [Int16Array, Int16Array]
}

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

function downmixToMono(planar: Int16Array[], channels: number): Int16Array {
  const frameLength = planar[0]?.length ?? 0
  const mono = new Int16Array(frameLength)

  for (let i = 0; i < frameLength; i++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) {
      sum += planar[channel]?.[i] ?? 0
    }
    mono[i] = Math.round(sum / Math.max(1, channels))
  }

  return mono
}

function normalizeChannels(
  planar: Int16Array[],
  channels: number,
  channelMode: ResolvedMp3EncoderOptions["channelMode"]
): [Int16Array, Int16Array] {
  const left = planar[0] ?? new Int16Array(0)
  if (channelMode === "mono") {
    const mono = channels <= 1 ? left : downmixToMono(planar, channels)
    return [mono, mono]
  }

  const right = channels > 1 ? (planar[1] ?? left) : left
  return [left, right]
}

function normalizeFrame(
  options: Mp3ChunkedEncoderOptions,
  channels: number,
  sampleRate: number,
  planar: Int16Array[]
): { frame: NormalizedFrame; encoderOptions: ResolvedMp3EncoderOptions } {
  const targetChannels =
    options.channelMode === "mono" ? 1 : Math.min(Math.max(channels, 1), 2)
  const encoderOptions = resolveMp3EncoderOptions(
    options,
    options.sampleRate ?? sampleRate,
    targetChannels
  )

  const channelNormalized = normalizeChannels(
    planar,
    channels,
    encoderOptions.channelMode
  )
  const snapshot = createFrameSnapshot(
    encoderOptions.channelMode === "mono" ? 1 : 2,
    sampleRate,
    encoderOptions.channelMode === "mono"
      ? [channelNormalized[0]]
      : [channelNormalized[0], channelNormalized[1]]
  )
  const resampled =
    snapshot.sampleRate === encoderOptions.sampleRate
      ? snapshot
      : resample(snapshot, encoderOptions.sampleRate, {})

  const left = resampled.planar[0] ?? new Int16Array(0)
  const right =
    encoderOptions.channelMode === "mono" ? left : (resampled.planar[1] ?? left)

  return {
    frame: {
      channels: encoderOptions.channelMode === "mono" ? 1 : 2,
      sampleRate: encoderOptions.sampleRate,
      planar: [left, right],
    },
    encoderOptions,
  }
}

function createMp3ChunkedEncoder(
  options: Mp3ChunkedEncoderOptions = {}
): ChunkedEncoder {
  let encoder: Mp3WasmEncoderHandle | null = null

  const getOrCreateEncoder = (
    normalized: NormalizedFrame,
    encoderOptions: ResolvedMp3EncoderOptions
  ) => {
    if (encoder) {
      if (
        encoder.channels !== normalized.channels ||
        encoder.sampleRate !== normalized.sampleRate
      ) {
        throw new Error(
          "MP3 chunked encoder does not support mid-stream format changes."
        )
      }
      return encoder
    }

    encoder = createMp3Encoder(encoderOptions, normalized.channels)
    return encoder
  }

  return {
    feedFrame(channels, sampleRate, planar) {
      const frameLength = planar[0]?.length ?? 0
      if (frameLength === 0) {
        return null
      }

      const { frame, encoderOptions } = normalizeFrame(
        options,
        channels,
        sampleRate,
        planar
      )
      const liveEncoder = getOrCreateEncoder(frame, encoderOptions)
      const encoded = liveEncoder.encode(
        frame.planar[0],
        frame.planar[1],
        frame.planar[0].length
      )
      return encoded.length > 0 ? encoded : null
    },

    flush() {
      if (!encoder) {
        return null
      }

      const flushed = encoder.flush()
      encoder.free()
      encoder = null
      return flushed.length > 0 ? flushed : null
    },

    dispose() {
      encoder?.free()
      encoder = null
    },
  }
}

export const mp3ChunkedEncoderDefinition: ChunkedEncoderDefinition<Mp3ChunkedEncoderOptions> =
  {
    format: "mp3",
    preload: preloadMp3Module,
    create: createMp3ChunkedEncoder,
  }
