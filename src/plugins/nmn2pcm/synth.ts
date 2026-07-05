import type { CompiledScore } from "./types"

export function synthesizeNmnScore(
  compiled: CompiledScore,
  options: { sampleRate: number; bpm: number; volume: number }
): { data: Int16Array; durationMs: number } {
  const beatDurationMs = 60000 / options.bpm
  const totalDurationMs = compiled.totalBeats * beatDurationMs
  const totalSamples = Math.max(
    1,
    Math.ceil((totalDurationMs / 1000) * options.sampleRate)
  )
  const mixed = new Float32Array(totalSamples)

  for (const event of compiled.events) {
    renderEvent(mixed, event, options)
  }

  let peak = 0
  for (let index = 0; index < mixed.length; index += 1) {
    peak = Math.max(peak, Math.abs(mixed[index] ?? 0))
  }

  const normalizeScale = peak > 0.98 ? 0.98 / peak : 1
  const data = new Int16Array(mixed.length)

  for (let index = 0; index < mixed.length; index += 1) {
    const sample = (mixed[index] ?? 0) * normalizeScale
    data[index] =
      sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767)
  }

  return {
    data,
    durationMs: totalDurationMs,
  }
}

function renderEvent(
  output: Float32Array,
  event: {
    midi: number
    startBeat: number
    durationBeats: number
    velocity: number
    legato?: boolean
  },
  options: { sampleRate: number; bpm: number; volume: number }
): void {
  const secondsPerBeat = 60 / options.bpm
  const startSample = Math.round(
    event.startBeat * secondsPerBeat * options.sampleRate
  )
  const sampleLength = Math.max(
    1,
    Math.round(event.durationBeats * secondsPerBeat * options.sampleRate)
  )
  const frequency = 440 * Math.pow(2, (event.midi - 69) / 12)
  const attackSamples = event.legato
    ? 0
    : Math.min(
        Math.round(options.sampleRate * 0.005),
        Math.floor(sampleLength / 4)
      )
  const releaseSamples = Math.min(
    Math.round(options.sampleRate * 0.03),
    Math.floor(sampleLength / 3)
  )

  for (let offset = 0; offset < sampleLength; offset += 1) {
    const sampleIndex = startSample + offset
    if (sampleIndex >= output.length) {
      break
    }
    const amplitude = resolveEnvelope(
      offset,
      sampleLength,
      attackSamples,
      releaseSamples
    )
    const t = offset / options.sampleRate
    const base = Math.sin(2 * Math.PI * frequency * t)
    const harmonic = 0.18 * Math.sin(4 * Math.PI * frequency * t)
    output[sampleIndex] =
      (output[sampleIndex] ?? 0) +
      (base + harmonic) * amplitude * event.velocity * options.volume
  }
}

function resolveEnvelope(
  sampleIndex: number,
  sampleLength: number,
  attackSamples: number,
  releaseSamples: number
): number {
  if (sampleLength <= 1) {
    return 1
  }
  if (attackSamples > 0 && sampleIndex < attackSamples) {
    return sampleIndex / attackSamples
  }
  if (releaseSamples > 0 && sampleIndex > sampleLength - releaseSamples) {
    return Math.max(0, (sampleLength - sampleIndex) / releaseSamples)
  }
  return 1
}
