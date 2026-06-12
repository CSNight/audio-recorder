import type { AudioChannelCount, AudioFrame } from "../types"

export function resolveChannelCount(
  requested?: number | null
): AudioChannelCount {
  return requested === 2 ? 2 : 1
}

export function toInt16Sample(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
}

export function createAudioFrame(
  planarFloat: readonly Float32Array[],
  sampleRate: number,
  timestamp: number
): AudioFrame {
  const channels = resolveChannelCount(planarFloat.length)
  const sourceChannels = planarFloat.slice(0, channels)
  const frameLength = sourceChannels[0]?.length ?? 0

  const planar = sourceChannels.map((channel) => {
    const output = new Int16Array(frameLength)

    for (let index = 0; index < frameLength; index += 1) {
      output[index] = toInt16Sample(channel[index] ?? 0)
    }

    return output
  })

  return {
    channels,
    sampleRate,
    timestamp,
    durationMs: frameLength === 0 ? 0 : (frameLength / sampleRate) * 1000,
    planar,
  }
}
