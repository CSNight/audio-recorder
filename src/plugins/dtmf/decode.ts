import type {
  DtmfCandidate,
  DtmfDecodeOptions,
  DtmfDetectEvent,
  DtmfKey,
} from "./types"

const ROW_FREQUENCIES = [697, 770, 852, 941] as const
const COLUMN_FREQUENCIES = [1209, 1336, 1477, 1633] as const
const DTMF_MATRIX: DtmfKey[][] = [
  ["1", "2", "3", "A"],
  ["4", "5", "6", "B"],
  ["7", "8", "9", "C"],
  ["*", "0", "#", "D"],
]

type ActiveCandidate = DtmfCandidate & {
  stableMs: number
  gapMs: number
  emitted: boolean
}

const DEFAULT_OPTIONS: Required<DtmfDecodeOptions> = {
  frameWindowMs: 20,
  minToneMs: 20,
  minGapMs: 20,
  energyThreshold: 0.01,
}

export class DtmfDetector {
  private readonly options: Required<DtmfDecodeOptions>
  private sampleRate = 0
  private windowSize = 0
  private windowDurationMs = 0
  private sampleBuffer: number[] = []
  private nextWindowStartMs = 0
  private activeCandidate: ActiveCandidate | undefined

  constructor(options: DtmfDecodeOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    }
  }

  reset(): void {
    this.sampleRate = 0
    this.windowSize = 0
    this.windowDurationMs = 0
    this.sampleBuffer = []
    this.nextWindowStartMs = 0
    this.activeCandidate = undefined
  }

  push(
    mono: Int16Array,
    sampleRate: number,
    timestampMs: number
  ): DtmfDetectEvent[] {
    if (mono.length === 0) {
      return []
    }

    if (this.sampleRate !== sampleRate) {
      this.reset()
      this.sampleRate = sampleRate
      this.windowSize = Math.max(
        64,
        Math.round((sampleRate * this.options.frameWindowMs) / 1000)
      )
      this.windowDurationMs = (this.windowSize / sampleRate) * 1000
      this.nextWindowStartMs = timestampMs
    }

    for (let index = 0; index < mono.length; index += 1) {
      this.sampleBuffer.push((mono[index] ?? 0) / 32768)
    }

    const events: DtmfDetectEvent[] = []

    while (this.sampleBuffer.length >= this.windowSize) {
      const window = new Float32Array(
        this.sampleBuffer.slice(0, this.windowSize)
      )
      this.sampleBuffer = this.sampleBuffer.slice(this.windowSize)
      const startedAtMs = this.nextWindowStartMs
      const endedAtMs = startedAtMs + this.windowDurationMs
      const candidate = detectCandidate(window, this.sampleRate, this.options)
      const detected = this.consumeCandidate(candidate, endedAtMs)
      if (detected) {
        events.push(detected)
      }
      this.nextWindowStartMs = endedAtMs
    }

    return events
  }

  private consumeCandidate(
    candidate: DtmfCandidate | undefined,
    endedAtMs: number
  ): DtmfDetectEvent | undefined {
    if (!candidate) {
      if (!this.activeCandidate) {
        return undefined
      }
      this.activeCandidate.gapMs += this.windowDurationMs
      if (this.activeCandidate.gapMs >= this.options.minGapMs) {
        this.activeCandidate = undefined
      }
      return undefined
    }

    if (
      this.activeCandidate &&
      this.activeCandidate.key === candidate.key &&
      this.activeCandidate.rowHz === candidate.rowHz &&
      this.activeCandidate.colHz === candidate.colHz
    ) {
      this.activeCandidate.stableMs += this.windowDurationMs
      this.activeCandidate.gapMs = 0
      if (
        !this.activeCandidate.emitted &&
        this.activeCandidate.stableMs >= this.options.minToneMs
      ) {
        this.activeCandidate.emitted = true
        return {
          key: candidate.key,
          startedAtMs: endedAtMs - this.activeCandidate.stableMs,
          endedAtMs,
          durationMs: this.activeCandidate.stableMs,
          rowHz: candidate.rowHz,
          colHz: candidate.colHz,
        }
      }
      return undefined
    }

    this.activeCandidate = {
      ...candidate,
      stableMs: this.windowDurationMs,
      gapMs: 0,
      emitted: false,
    }
    return undefined
  }
}

function detectCandidate(
  window: Float32Array,
  sampleRate: number,
  options: Required<DtmfDecodeOptions>
): DtmfCandidate | undefined {
  const rms = computeRms(window)
  if (rms < options.energyThreshold) {
    return undefined
  }

  const rowPowers = ROW_FREQUENCIES.map((freq) =>
    goertzel(window, sampleRate, freq)
  )
  const columnPowers = COLUMN_FREQUENCIES.map((freq) =>
    goertzel(window, sampleRate, freq)
  )
  const row = pickDominant(rowPowers)
  const column = pickDominant(columnPowers)

  if (!row || !column) {
    return undefined
  }

  const key = DTMF_MATRIX[row.index]?.[column.index]
  if (!key) {
    return undefined
  }

  return {
    key,
    rowHz: ROW_FREQUENCIES[row.index]!,
    colHz: COLUMN_FREQUENCIES[column.index]!,
  }
}

function pickDominant(
  powers: number[]
): { index: number; power: number } | undefined {
  let strongestIndex = -1
  let strongestPower = 0
  let secondPower = 0

  for (let index = 0; index < powers.length; index += 1) {
    const power = powers[index] ?? 0
    if (power > strongestPower) {
      secondPower = strongestPower
      strongestPower = power
      strongestIndex = index
    } else if (power > secondPower) {
      secondPower = power
    }
  }

  if (strongestIndex < 0 || strongestPower <= 0) {
    return undefined
  }

  if (secondPower > 0 && strongestPower / secondPower < 2.5) {
    return undefined
  }

  return {
    index: strongestIndex,
    power: strongestPower,
  }
}

function goertzel(
  samples: Float32Array,
  sampleRate: number,
  frequency: number
): number {
  const normalizedFrequency = frequency / sampleRate
  const coefficient = 2 * Math.cos(2 * Math.PI * normalizedFrequency)
  let q1 = 0
  let q2 = 0

  for (let index = 0; index < samples.length; index += 1) {
    const next = coefficient * q1 - q2 + (samples[index] ?? 0)
    q2 = q1
    q1 = next
  }

  return q1 * q1 + q2 * q2 - coefficient * q1 * q2
}

function computeRms(samples: Float32Array): number {
  let total = 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0
    total += sample * sample
  }
  return samples.length === 0 ? 0 : Math.sqrt(total / samples.length)
}
