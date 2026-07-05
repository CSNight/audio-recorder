export type DtmfKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "*"
  | "#"
  | "A"
  | "B"
  | "C"
  | "D"

export interface DtmfEncodeOptions {
  sampleRate?: number
  toneMs?: number
  gapMs?: number
  amplitude?: number
}

export interface DtmfDecodeOptions {
  frameWindowMs?: number
  minToneMs?: number
  minGapMs?: number
  /** 这里按输入 PCM 的 RMS 阈值解释，默认 0.03。 */
  energyThreshold?: number
}

export interface DtmfDetectEvent {
  key: DtmfKey
  startedAtMs: number
  endedAtMs: number
  durationMs: number
  rowHz: number
  colHz: number
}

export interface DtmfCandidate {
  key: DtmfKey
  rowHz: number
  colHz: number
}
