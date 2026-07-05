import type { DtmfEncodeOptions, DtmfKey } from "./types"

const DTMF_FREQUENCIES: Record<DtmfKey, readonly [number, number]> = {
  "1": [697, 1209],
  "2": [697, 1336],
  "3": [697, 1477],
  A: [697, 1633],
  "4": [770, 1209],
  "5": [770, 1336],
  "6": [770, 1477],
  B: [770, 1633],
  "7": [852, 1209],
  "8": [852, 1336],
  "9": [852, 1477],
  C: [852, 1633],
  "*": [941, 1209],
  "0": [941, 1336],
  "#": [941, 1477],
  D: [941, 1633],
}

export function encodeDtmf(
  keys: DtmfKey[],
  options: DtmfEncodeOptions = {}
): Int16Array {
  const sampleRate = Math.max(1000, Math.floor(options.sampleRate ?? 8000))
  const toneMs = Math.max(1, options.toneMs ?? 100)
  const gapMs = Math.max(0, options.gapMs ?? 50)
  const amplitude = Math.max(0, Math.min(1, options.amplitude ?? 0.7))
  const toneSamples = Math.max(1, Math.round((sampleRate * toneMs) / 1000))
  const gapSamples = Math.max(0, Math.round((sampleRate * gapMs) / 1000))
  const totalSamples =
    keys.length * toneSamples + Math.max(0, keys.length - 1) * gapSamples
  const output = new Int16Array(totalSamples)
  let writeOffset = 0

  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex]
    if (!key) {
      continue
    }
    const [rowHz, colHz] = DTMF_FREQUENCIES[key]
    for (let sampleIndex = 0; sampleIndex < toneSamples; sampleIndex += 1) {
      const t = sampleIndex / sampleRate
      const sample =
        ((Math.sin(2 * Math.PI * rowHz * t) +
          Math.sin(2 * Math.PI * colHz * t)) /
          2) *
        amplitude
      output[writeOffset + sampleIndex] = toInt16(sample)
    }
    writeOffset += toneSamples
    if (keyIndex < keys.length - 1) {
      writeOffset += gapSamples
    }
  }

  return output
}

export function lookupDtmfFrequencies(key: DtmfKey): readonly [number, number] {
  return DTMF_FREQUENCIES[key]
}

function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
}
