import type {
  NmnDynamicMark,
  NmnOrnamentKind,
  ParsedDynamic,
  ParsedElement,
  ParsedOrnament,
  ParsedPitch,
  ParsedScore,
} from "./types"

export function parseNmnScore(score: string): ParsedScore {
  const tokens = tokenizeScore(score)
  const elements: ParsedElement[] = []

  for (const token of tokens) {
    if (!token || token === "|") {
      continue
    }
    if (token === "~") {
      const previous = elements[elements.length - 1]
      if (previous?.kind === "note-group" || previous?.kind === "ornament") {
        previous.tieToNext = true
      }
      continue
    }

    const dynamic = parseDynamicToken(token)
    if (dynamic) {
      elements.push(dynamic)
      continue
    }

    const ornament = parseOrnamentToken(token)
    if (ornament) {
      elements.push(ornament)
      continue
    }

    elements.push(parseNoteGroupToken(token))
  }

  return { elements }
}

function tokenizeScore(score: string): string[] {
  const tokens: string[] = []
  let current = ""
  let bracketDepth = 0
  let parenDepth = 0

  for (let index = 0; index < score.length; index += 1) {
    const char = score[index]!

    if (char === "[") bracketDepth += 1
    if (char === "]") bracketDepth -= 1
    if (char === "(") parenDepth += 1
    if (char === ")") parenDepth -= 1

    if (/\s/.test(char) && bracketDepth === 0 && parenDepth === 0) {
      if (current) {
        tokens.push(current)
        current = ""
      }
      continue
    }

    if (char === "|" && bracketDepth === 0 && parenDepth === 0) {
      if (current) {
        tokens.push(current)
        current = ""
      }
      tokens.push("|")
      continue
    }

    if (char === "~" && bracketDepth === 0 && parenDepth === 0) {
      if (current) {
        tokens.push(current)
        current = ""
      }
      tokens.push("~")
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

function parseDynamicToken(token: string): ParsedDynamic | undefined {
  const match = token.match(/^!(pp|p|mp|mf|f|ff)!$/)
  if (!match) {
    return undefined
  }

  return {
    kind: "dynamic",
    dynamic: match[1] as NmnDynamicMark,
  }
}

function parseOrnamentToken(token: string): ParsedOrnament | undefined {
  const match = token.match(/^(tr|mord|turn)\((.+)\)$/)
  if (match) {
    const main = parsePitchToken(match[2]!)
    return {
      kind: "ornament",
      ornament: normalizeOrnamentKind(match[1]!),
      main: main.pitch,
      durationBeats: main.durationBeats,
      tieToNext: main.tieToNext,
    }
  }

  const graceMatch = token.match(/^grace\((.+)->(.+)\)$/)
  if (graceMatch) {
    const grace = parsePitchToken(graceMatch[1]!)
    const main = parsePitchToken(graceMatch[2]!)
    return {
      kind: "ornament",
      ornament: "grace",
      main: main.pitch,
      grace: grace.pitch,
      durationBeats: main.durationBeats,
      tieToNext: main.tieToNext,
    }
  }

  return undefined
}

function normalizeOrnamentKind(value: string): NmnOrnamentKind {
  switch (value) {
    case "tr":
      return "trill"
    case "mord":
      return "mordent"
    default:
      return "turn"
  }
}

function parseNoteGroupToken(token: string): ParsedElement {
  const tieToNext = token.endsWith("~")
  const normalizedToken = tieToNext ? token.slice(0, -1) : token

  if (normalizedToken.startsWith("[") && normalizedToken.includes("]")) {
    const endIndex = normalizedToken.indexOf("]")
    const content = normalizedToken.slice(1, endIndex)
    const suffix = normalizedToken.slice(endIndex + 1)
    const pitches = content
      .split(/\s+/)
      .filter(Boolean)
      .map((item) => parsePitchToken(item).pitch)
    return {
      kind: "note-group",
      pitches,
      durationBeats: resolveDurationBeats(suffix),
      tieToNext,
    }
  }

  const parsed = parsePitchToken(normalizedToken)
  return {
    kind: "note-group",
    pitches: [parsed.pitch],
    durationBeats: parsed.durationBeats,
    tieToNext,
  }
}

function parsePitchToken(token: string): {
  pitch: ParsedPitch
  durationBeats: number
  tieToNext: boolean
} {
  const tieToNext = token.endsWith("~")
  const normalized = tieToNext ? token.slice(0, -1) : token
  const match = normalized.match(
    /^([#b]*)([0-7])([',]*)([-.]*)(?:\/(\d+(?:\.\d+)?))?(?:\*(\d+(?:\.\d+)?))?$/
  )

  if (!match) {
    throw new Error(`Unsupported NMN token "${token}".`)
  }

  const accidental = resolveAccidental(match[1] ?? "")
  const degree = Number(match[2] ?? "0")
  const octaveShift = resolveOctaveShift(match[3] ?? "")
  const durationBeats = resolveDurationBeats(
    `${match[4] ?? ""}${match[5] ? `/${match[5]}` : ""}${match[6] ? `*${match[6]}` : ""}`
  )

  return {
    pitch: {
      degree,
      accidental,
      octaveShift,
    },
    durationBeats,
    tieToNext,
  }
}

function resolveAccidental(input: string): number {
  let value = 0
  for (let index = 0; index < input.length; index += 1) {
    value += input[index] === "#" ? 1 : -1
  }
  return value
}

function resolveOctaveShift(input: string): number {
  let shift = 0
  for (let index = 0; index < input.length; index += 1) {
    shift += input[index] === "'" ? 1 : -1
  }
  return shift
}

function resolveDurationBeats(input: string): number {
  const dashMatches = input.match(/-/g)?.length ?? 0
  let duration = 1 + dashMatches
  let dotFactor = 1
  let currentAddition = duration / 2
  const dotMatches = input.match(/\./g)?.length ?? 0
  for (let index = 0; index < dotMatches; index += 1) {
    dotFactor += currentAddition / duration
    currentAddition /= 2
  }
  duration *= dotFactor

  const divideMatch = input.match(/\/(\d+(?:\.\d+)?)/)
  if (divideMatch) {
    duration /= Number(divideMatch[1]!)
  }

  const multiplyMatch = input.match(/\*(\d+(?:\.\d+)?)/)
  if (multiplyMatch) {
    duration *= Number(multiplyMatch[1]!)
  }

  return duration
}
