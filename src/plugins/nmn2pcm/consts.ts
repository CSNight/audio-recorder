import type { NmnConvertOptions, NmnDynamicMark } from "./types"

export const DEFAULT_NMN_OPTIONS: Required<NmnConvertOptions> = {
  sampleRate: 16000,
  bpm: 60,
  volume: 0.5,
  key: "C",
  transpose: 0,
}

export const DYNAMIC_VELOCITY: Record<NmnDynamicMark, number> = {
  pp: 0.25,
  p: 0.4,
  mp: 0.55,
  mf: 0.7,
  f: 0.85,
  ff: 1,
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11] as const
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10] as const
const NOTE_OFFSETS: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
}

export function resolveConvertOptions(
  options: NmnConvertOptions = {}
): Required<NmnConvertOptions> {
  return {
    sampleRate: Math.max(
      1000,
      Math.floor(options.sampleRate ?? DEFAULT_NMN_OPTIONS.sampleRate)
    ),
    bpm: Math.max(1, options.bpm ?? DEFAULT_NMN_OPTIONS.bpm),
    volume: Math.max(
      0,
      Math.min(1, options.volume ?? DEFAULT_NMN_OPTIONS.volume)
    ),
    key:
      (options.key ?? DEFAULT_NMN_OPTIONS.key).trim() ||
      DEFAULT_NMN_OPTIONS.key,
    transpose: Math.round(options.transpose ?? DEFAULT_NMN_OPTIONS.transpose),
  }
}

export function resolvePitchMidi(
  pitch: { degree: number; accidental: number; octaveShift: number },
  key: string,
  transpose: number
): number | undefined {
  if (pitch.degree === 0) {
    return undefined
  }

  const { tonicOffset, scale } = resolveKeyScale(key)
  const scaleOffset = scale[pitch.degree - 1]
  if (scaleOffset === undefined) {
    throw new Error(`Unsupported scale degree "${pitch.degree}".`)
  }

  return (
    60 +
    tonicOffset +
    scaleOffset +
    pitch.accidental +
    pitch.octaveShift * 12 +
    transpose
  )
}

function resolveKeyScale(key: string): {
  tonicOffset: number
  scale: readonly number[]
} {
  const isMinor = /m$/i.test(key)
  const noteName = key.replace(/m$/i, "") || "C"
  const tonicOffset = NOTE_OFFSETS[noteName]

  if (tonicOffset === undefined) {
    throw new Error(`Unsupported key "${key}".`)
  }

  return {
    tonicOffset,
    scale: isMinor ? MINOR_SCALE : MAJOR_SCALE,
  }
}
