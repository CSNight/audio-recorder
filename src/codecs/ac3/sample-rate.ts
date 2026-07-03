import type { Ac3Codec, Ac3SampleRate } from "./types"
import { pickNearestSupportedSampleRate } from "@csnight/audio-recorder"

export const AC3_SAMPLE_RATES = [32000, 44100, 48000] as const satisfies readonly Ac3SampleRate[]
export const EAC3_SAMPLE_RATES = [
  16000, 22050, 24000, 32000, 44100, 48000,
] as const satisfies readonly Ac3SampleRate[]

const AC3_SAMPLE_RATE_SET = new Set<number>(AC3_SAMPLE_RATES)
const EAC3_SAMPLE_RATE_SET = new Set<number>(EAC3_SAMPLE_RATES)

export function isSupportSampleRate(
  sampleRate: number,
  codec: Ac3Codec = "ac3"
): sampleRate is Ac3SampleRate {
  return codec === "ac3"
    ? AC3_SAMPLE_RATE_SET.has(sampleRate)
    : EAC3_SAMPLE_RATE_SET.has(sampleRate)
}

export function resolveExportSampleRate(
  sampleRate: number | undefined,
  actualSampleRate: number,
  codec: Ac3Codec = "ac3"
): Ac3SampleRate {
  const supportedSampleRates =
    codec === "ac3" ? AC3_SAMPLE_RATES : EAC3_SAMPLE_RATES
  const targetSampleRate = sampleRate ?? actualSampleRate

  return isSupportSampleRate(targetSampleRate, codec)
    ? targetSampleRate
    : (pickNearestSupportedSampleRate(
        targetSampleRate,
        supportedSampleRates
      ) as Ac3SampleRate)
}
