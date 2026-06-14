import type { PcmBufferSnapshot } from "@/buffer/types"
import type { AudioChannelCount } from "@/types"

export interface ResampledPcm {
  sampleRate: number
  channels: AudioChannelCount
  durationMs: number
  planar: Int16Array[]
}

export function resamplePlanarPcm(
  snapshot: PcmBufferSnapshot,
  targetSampleRate: number
): ResampledPcm {
  if (targetSampleRate <= 0) {
    throw new Error(
      `Resample target sampleRate must be positive, received ${targetSampleRate}.`
    )
  }

  if (targetSampleRate === snapshot.sampleRate) {
    return {
      sampleRate: snapshot.sampleRate,
      channels: snapshot.channels,
      durationMs: snapshot.durationMs,
      planar: snapshot.planar.map((channel) => new Int16Array(channel)),
    }
  }

  const planar = snapshot.planar.map((channel) =>
    resampleChannel(channel, snapshot.sampleRate, targetSampleRate)
  )
  const frameLength = planar[0]?.length ?? 0

  return {
    sampleRate: targetSampleRate,
    channels: snapshot.channels,
    durationMs: frameLength === 0 ? 0 : (frameLength / targetSampleRate) * 1000,
    planar,
  }
}

function resampleChannel(
  input: Int16Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Int16Array {
  if (input.length === 0) {
    return new Int16Array(0)
  }

  const ratio = sourceSampleRate / targetSampleRate
  const targetLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Int16Array(targetLength)

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const sourcePosition = targetIndex * ratio
    const leftIndex = Math.floor(sourcePosition)
    const rightIndex = Math.min(input.length - 1, leftIndex + 1)
    const interpolationWeight = sourcePosition - leftIndex
    const leftSample = input[leftIndex] ?? 0
    const rightSample = input[rightIndex] ?? leftSample

    output[targetIndex] = Math.round(
      leftSample + (rightSample - leftSample) * interpolationWeight
    )
  }

  return output
}
