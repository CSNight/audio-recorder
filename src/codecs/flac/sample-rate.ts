import { isPositiveIntegerSampleRate } from "@media-studio/audio-recorder"

export function isSupportSampleRate(sampleRate: number): boolean {
  return isPositiveIntegerSampleRate(sampleRate) && sampleRate <= 1048575
}

export function resolveExportSampleRate(
  sampleRate: number | undefined,
  actualSampleRate: number
): number {
  const targetSampleRate = sampleRate ?? actualSampleRate
  if (!isSupportSampleRate(targetSampleRate)) {
    throw new RangeError(
      `FLAC encoder requires sampleRate to be an integer between 1 and 1048575, received ${targetSampleRate}.`
    )
  }

  return targetSampleRate
}
