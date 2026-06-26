import type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
} from "@/plugins/streaming-export/types"
import type { PcmBufferSnapshot } from "@/buffer/types"
import { resample } from "@/utils/resample"
import {
  createAmrEncoder,
  getAmrStreamHeader,
  getAmrTargetSampleRate,
  preloadAmrModules,
} from "./amr-wasm-api"
import type { AmrEncoderOptions } from "./types"

export type AmrChunkedEncoderOptions = AmrEncoderOptions

function appendMono(target: Int16Array, incoming: Int16Array): Int16Array {
  if (target.length === 0) {
    return new Int16Array(incoming)
  }

  const merged = new Int16Array(target.length + incoming.length)
  merged.set(target)
  merged.set(incoming, target.length)
  return merged
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

function createFrameSnapshot(
  sampleRate: number,
  planar: Int16Array[]
): PcmBufferSnapshot {
  const frameLength = planar[0]?.length ?? 0
  return {
    sampleRate,
    channels: 1,
    frameCount: 1,
    durationMs: frameLength === 0 ? 0 : (frameLength / sampleRate) * 1000,
    planar: [planar[0] ?? new Int16Array(0)],
  }
}

function createAmrChunkedEncoder(
  options: AmrChunkedEncoderOptions = {}
): ChunkedEncoder {
  const bandMode = options.bandMode ?? "nb"
  const targetSampleRate = getAmrTargetSampleRate(bandMode)
  const header = getAmrStreamHeader(bandMode)
  const encoder = createAmrEncoder({ bandMode })

  let bufferedMono: Int16Array<ArrayBufferLike> = new Int16Array(0)
  let headerWritten = false

  const collectChunk = (frames: Uint8Array[]): Uint8Array | null => {
    if (frames.length === 0) {
      return null
    }

    const chunks = headerWritten ? frames : [header, ...frames]
    headerWritten = true
    return concatChunks(chunks)
  }

  return {
    feedFrame(_channels, sampleRate, planar) {
      const mono = planar[0]
      if (!mono || mono.length === 0) {
        return null
      }

      const normalized =
        sampleRate === targetSampleRate
          ? mono
          : resample(
              createFrameSnapshot(sampleRate, [mono]),
              targetSampleRate,
              {}
            ).planar[0]!

      bufferedMono = appendMono(bufferedMono, normalized)

      const frames: Uint8Array[] = []
      while (bufferedMono.length >= encoder.frameSize) {
        frames.push(
          encoder.encode(
            new Int16Array(bufferedMono.subarray(0, encoder.frameSize))
          )
        )
        bufferedMono = new Int16Array(bufferedMono.subarray(encoder.frameSize))
      }

      return collectChunk(frames)
    },

    flush() {
      if (bufferedMono.length === 0) {
        return null
      }

      const padded = new Int16Array(encoder.frameSize)
      padded.set(bufferedMono)
      bufferedMono = new Int16Array(0)
      return collectChunk([encoder.encode(padded)])
    },

    dispose() {
      bufferedMono = new Int16Array(0)
      encoder.free()
    },
  }
}

export const amrChunkedEncoderDefinition: ChunkedEncoderDefinition<AmrChunkedEncoderOptions> =
  {
    format: "amr",
    preload: preloadAmrModules,
    create: createAmrChunkedEncoder,
  }
