import type { OpusSampleRate } from "./types"
import { pickNearestSupportedSampleRate } from "@media-studio/audio-recorder"

export const OPUS_SAMPLE_RATES = [
  8000, 12000, 16000, 24000, 48000,
] as const satisfies readonly OpusSampleRate[]

const OPUS_SAMPLE_RATE_SET = new Set<number>(OPUS_SAMPLE_RATES)

export function isSupportSampleRate(
  sampleRate: number
): sampleRate is OpusSampleRate {
  return OPUS_SAMPLE_RATE_SET.has(sampleRate)
}

export function resolveExportSampleRate(
  sampleRate: number | undefined,
  actualSampleRate: number
): OpusSampleRate {
  const targetSampleRate = sampleRate ?? actualSampleRate

  return isSupportSampleRate(targetSampleRate)
    ? targetSampleRate
    : (pickNearestSupportedSampleRate(
        targetSampleRate,
        OPUS_SAMPLE_RATES
      ) as OpusSampleRate)
}
