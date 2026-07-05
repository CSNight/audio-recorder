export type NmnDynamicMark = "pp" | "p" | "mp" | "mf" | "f" | "ff"
export type NmnOrnamentKind = "trill" | "mordent" | "turn" | "grace"

export interface NmnConvertOptions {
  sampleRate?: number
  bpm?: number
  volume?: number
  key?: string
  transpose?: number
}

export interface NmnConvertResult {
  data: Int16Array
  sampleRate: number
  durationMs: number
  channels: 1
}

export interface ParsedPitch {
  degree: number
  accidental: number
  octaveShift: number
}

export interface ParsedNoteGroup {
  kind: "note-group"
  pitches: ParsedPitch[]
  durationBeats: number
  tieToNext: boolean
}

export interface ParsedDynamic {
  kind: "dynamic"
  dynamic: NmnDynamicMark
}

export interface ParsedOrnament {
  kind: "ornament"
  ornament: NmnOrnamentKind
  main: ParsedPitch
  grace?: ParsedPitch
  durationBeats: number
  tieToNext: boolean
}

export type ParsedElement = ParsedNoteGroup | ParsedDynamic | ParsedOrnament

export interface ParsedScore {
  elements: ParsedElement[]
}

export interface CompiledNoteEvent {
  midi: number
  startBeat: number
  durationBeats: number
  velocity: number
  legato?: boolean
}

export interface CompiledScore {
  events: CompiledNoteEvent[]
  totalBeats: number
}
