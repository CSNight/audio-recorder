import type { AmrBandMode, AmrExportOptions } from "./types"
import { pickNearestSupportedSampleRate } from "@csnight/audio-recorder"

const AMR_SAMPLE_RATES = {
  nb: 8000,
  wb: 16000,
} as const satisfies Record<AmrBandMode, 8000 | 16000>

export function isSupportSampleRate(
  sampleRate: number,
  options: AmrExportOptions = {}
): sampleRate is 8000 | 16000 {
  if (options.bandMode) {
    return sampleRate === AMR_SAMPLE_RATES[options.bandMode]
  }

  return sampleRate === AMR_SAMPLE_RATES.nb || sampleRate === AMR_SAMPLE_RATES.wb
}

export function resolveExportSampleRate(
  sampleRate: number | undefined,
  actualSampleRate: number,
  bandMode?: AmrBandMode
): 8000 | 16000 {
  const supportedSampleRates = bandMode
    ? [AMR_SAMPLE_RATES[bandMode]]
    : [AMR_SAMPLE_RATES.nb, AMR_SAMPLE_RATES.wb]
  const targetSampleRate = sampleRate ?? actualSampleRate
  const supportOptions = bandMode ? { bandMode } : {}

  return isSupportSampleRate(targetSampleRate, supportOptions)
    ? targetSampleRate
    : (pickNearestSupportedSampleRate(
        targetSampleRate,
        supportedSampleRates
      ) as 8000 | 16000)
}

export function resolveExportBandMode(
  bandMode: AmrBandMode | undefined,
  sampleRate: 8000 | 16000
): AmrBandMode {
  if (bandMode && sampleRate !== AMR_SAMPLE_RATES[bandMode]) {
    throw new RangeError(
      `AMR ${bandMode.toUpperCase()} does not support sampleRate ${sampleRate}.`
    )
  }

  return sampleRate === 8000
    ? "nb"
    : "wb"
}

export function resolveExportProfile(
  options: AmrExportOptions = {},
  actualSampleRate: number
): { bandMode: AmrBandMode; sampleRate: 8000 | 16000 } {
  const sampleRate = resolveExportSampleRate(
    options.sampleRate,
    actualSampleRate,
    options.bandMode
  )

  return {
    bandMode: resolveExportBandMode(options.bandMode, sampleRate),
    sampleRate,
  }
}
