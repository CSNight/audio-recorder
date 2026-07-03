import type { AacSampleRate } from "./types"
import { pickNearestSupportedSampleRate } from "@csnight/audio-recorder"

export const AAC_SAMPLE_RATES = [
  7350, 8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000,
  88200, 96000,
] as const satisfies readonly AacSampleRate[]

const AAC_SAMPLE_RATE_SET = new Set<number>(AAC_SAMPLE_RATES)

export function isSupportSampleRate(
  sampleRate: number
): sampleRate is AacSampleRate {
  return AAC_SAMPLE_RATE_SET.has(sampleRate)
}

export function resolveExportSampleRate(
  sampleRate: number | undefined,
  actualSampleRate: number
): AacSampleRate {
  const targetSampleRate = sampleRate ?? actualSampleRate

  return isSupportSampleRate(targetSampleRate)
    ? targetSampleRate
    : (pickNearestSupportedSampleRate(
        targetSampleRate,
        AAC_SAMPLE_RATES
      ) as AacSampleRate)
}
