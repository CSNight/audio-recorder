import type {
  CompiledNoteEvent,
  CompiledScore,
  ParsedElement,
  ParsedNoteGroup,
  ParsedOrnament,
  ParsedScore,
} from "./types"
import { DYNAMIC_VELOCITY, resolvePitchMidi } from "./vendor-compat"

export function compileNmnScore(
  parsed: ParsedScore,
  options: {
    key: string
    transpose: number
  }
): CompiledScore {
  const events: CompiledNoteEvent[] = []
  let currentBeat = 0
  let currentVelocity = DYNAMIC_VELOCITY.mf

  for (let index = 0; index < parsed.elements.length; index += 1) {
    const element = parsed.elements[index]!

    if (element.kind === "dynamic") {
      currentVelocity = DYNAMIC_VELOCITY[element.dynamic]
      continue
    }

    if (element.kind === "ornament") {
      const ornamentEvents = compileOrnament(
        element,
        currentBeat,
        currentVelocity,
        options
      )
      events.push(...ornamentEvents)
      currentBeat += element.durationBeats
      continue
    }

    const merged = mergeTiedGroups(parsed.elements, index)
    if (merged.skip) {
      continue
    }

    const groupEvents = compileNoteGroup(
      merged.group,
      currentBeat,
      currentVelocity,
      options
    )
    events.push(...groupEvents)
    currentBeat += merged.group.durationBeats
  }

  return {
    events,
    totalBeats: currentBeat,
  }
}

function mergeTiedGroups(
  elements: ParsedElement[],
  startIndex: number
): { group: ParsedNoteGroup; skip: boolean } {
  const base = elements[startIndex]
  if (!base || base.kind !== "note-group") {
    return {
      group: {
        kind: "note-group",
        pitches: [],
        durationBeats: 0,
        tieToNext: false,
      },
      skip: true,
    }
  }

  if (startIndex > 0) {
    const previous = elements[startIndex - 1]
    if (previous?.kind === "note-group" && previous.tieToNext) {
      const previousPitches = serializePitches(previous.pitches)
      const currentPitches = serializePitches(base.pitches)
      if (previousPitches === currentPitches) {
        return { group: base, skip: true }
      }
    }
  }

  const merged: ParsedNoteGroup = {
    ...base,
    pitches: [...base.pitches],
  }

  let cursor = startIndex
  while (merged.tieToNext) {
    const next = elements[cursor + 1]
    if (!next || next.kind !== "note-group") {
      break
    }
    if (serializePitches(next.pitches) !== serializePitches(merged.pitches)) {
      break
    }
    merged.durationBeats += next.durationBeats
    merged.tieToNext = next.tieToNext
    cursor += 1
  }

  return { group: merged, skip: false }
}

function compileNoteGroup(
  group: ParsedNoteGroup,
  startBeat: number,
  velocity: number,
  options: { key: string; transpose: number }
): CompiledNoteEvent[] {
  const events: CompiledNoteEvent[] = []

  for (const pitch of group.pitches) {
    const midi = resolvePitchMidi(pitch, options.key, options.transpose)
    if (midi === undefined) {
      continue
    }
    events.push({
      midi,
      startBeat,
      durationBeats: group.durationBeats,
      velocity,
    })
  }

  return events
}

function compileOrnament(
  ornament: ParsedOrnament,
  startBeat: number,
  velocity: number,
  options: { key: string; transpose: number }
): CompiledNoteEvent[] {
  const mainMidi = resolvePitchMidi(
    ornament.main,
    options.key,
    options.transpose
  )
  if (mainMidi === undefined) {
    return []
  }

  switch (ornament.ornament) {
    case "trill":
      return createTrill(mainMidi, startBeat, ornament.durationBeats, velocity)
    case "mordent":
      return createPattern(
        [mainMidi, mainMidi + 1, mainMidi],
        startBeat,
        ornament.durationBeats,
        velocity
      )
    case "turn":
      return createPattern(
        [mainMidi + 1, mainMidi, mainMidi - 1, mainMidi],
        startBeat,
        ornament.durationBeats,
        velocity
      )
    case "grace": {
      const graceMidi = ornament.grace
        ? resolvePitchMidi(ornament.grace, options.key, options.transpose)
        : undefined
      if (graceMidi === undefined) {
        return [
          {
            midi: mainMidi,
            startBeat,
            durationBeats: ornament.durationBeats,
            velocity,
          },
        ]
      }
      const graceDuration = Math.min(0.25, ornament.durationBeats * 0.25)
      return [
        {
          midi: graceMidi,
          startBeat,
          durationBeats: graceDuration,
          velocity: velocity * 0.85,
          legato: true,
        },
        {
          midi: mainMidi,
          startBeat: startBeat + graceDuration,
          durationBeats: ornament.durationBeats - graceDuration,
          velocity,
          legato: true,
        },
      ]
    }
  }
}

function createTrill(
  mainMidi: number,
  startBeat: number,
  durationBeats: number,
  velocity: number
): CompiledNoteEvent[] {
  const segmentCount = Math.max(4, Math.floor(durationBeats * 8))
  const segmentDuration = durationBeats / segmentCount
  const events: CompiledNoteEvent[] = []

  for (let index = 0; index < segmentCount; index += 1) {
    events.push({
      midi: index % 2 === 0 ? mainMidi : mainMidi + 1,
      startBeat: startBeat + index * segmentDuration,
      durationBeats: segmentDuration,
      velocity,
      legato: true,
    })
  }

  return events
}

function createPattern(
  midis: number[],
  startBeat: number,
  durationBeats: number,
  velocity: number
): CompiledNoteEvent[] {
  const segmentDuration = durationBeats / midis.length
  return midis.map((midi, index) => ({
    midi,
    startBeat: startBeat + index * segmentDuration,
    durationBeats: segmentDuration,
    velocity,
    legato: true,
  }))
}

function serializePitches(
  pitches: { degree: number; accidental: number; octaveShift: number }[]
): string {
  return pitches
    .map((pitch) => `${pitch.degree}:${pitch.accidental}:${pitch.octaveShift}`)
    .join("|")
}
