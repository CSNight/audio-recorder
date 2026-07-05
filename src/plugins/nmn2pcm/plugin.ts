import { compileNmnScore } from "./compiler"
import { parseNmnScore } from "./parser"
import { synthesizeNmnScore } from "./synth"
import type { NmnConvertOptions, NmnConvertResult } from "./types"
import { resolveConvertOptions } from "./consts"

export function nmn2pcm(
  score: string,
  options: NmnConvertOptions = {}
): NmnConvertResult {
  if (!score.trim()) {
    throw new Error("NMN score must not be empty.")
  }

  const resolved = resolveConvertOptions(options)
  const parsed = parseNmnScore(score)
  const compiled = compileNmnScore(parsed, {
    key: resolved.key,
    transpose: resolved.transpose,
  })
  const synthesized = synthesizeNmnScore(compiled, resolved)

  return {
    data: synthesized.data,
    sampleRate: resolved.sampleRate,
    durationMs: synthesized.durationMs,
    channels: 1,
  }
}
