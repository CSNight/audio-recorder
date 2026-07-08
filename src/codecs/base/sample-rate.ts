import { isPositiveIntegerSampleRate } from "@media-studio/audio-recorder"

export function isSupportSampleRate(sampleRate: number): boolean {
  return isPositiveIntegerSampleRate(sampleRate)
}

export function resolveExportSampleRate(
  sampleRate: number | undefined,
  actualSampleRate: number
): number {
  const targetSampleRate = sampleRate ?? actualSampleRate
  if (!isSupportSampleRate(targetSampleRate)) {
    throw new RangeError(
      `PCM/WAV export requires sampleRate to be a positive integer, received ${targetSampleRate}.`
    )
  }

  return targetSampleRate
}
