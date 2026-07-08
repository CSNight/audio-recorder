import type { Mp3SampleRate } from "./types"
import { pickNearestSupportedSampleRate } from "@media-studio/audio-recorder"

export const MP3_SAMPLE_RATES = [
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
] as const satisfies readonly Mp3SampleRate[]

const MP3_SAMPLE_RATE_SET = new Set<number>(MP3_SAMPLE_RATES)

export function isSupportSampleRate(
  sampleRate: number
): sampleRate is Mp3SampleRate {
  return MP3_SAMPLE_RATE_SET.has(sampleRate)
}

export function resolveExportSampleRate(
  sampleRate: number | undefined,
  actualSampleRate: number
): Mp3SampleRate {
  const targetSampleRate = sampleRate ?? actualSampleRate

  return isSupportSampleRate(targetSampleRate)
    ? targetSampleRate
    : (pickNearestSupportedSampleRate(
        targetSampleRate,
        MP3_SAMPLE_RATES
      ) as Mp3SampleRate)
}
