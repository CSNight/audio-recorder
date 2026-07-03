export function isPositiveIntegerSampleRate(sampleRate: number): boolean {
  return Number.isInteger(sampleRate) && sampleRate > 0
}

export function pickNearestSupportedSampleRate(
  sampleRate: number,
  supportedSampleRates: readonly number[]
): number {
  if (!isPositiveIntegerSampleRate(sampleRate)) {
    throw new RangeError(
      `sampleRate must be a positive integer, received ${sampleRate}.`
    )
  }
  if (supportedSampleRates.length === 0) {
    throw new RangeError("supportedSampleRates must not be empty.")
  }

  let nearest = supportedSampleRates[0]!
  let nearestDistance = Math.abs(sampleRate - nearest)

  for (const candidate of supportedSampleRates.slice(1)) {
    const distance = Math.abs(sampleRate - candidate)
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
      continue
    }
    if (distance === nearestDistance && candidate < nearest) {
      nearest = candidate
    }
  }

  return nearest
}
