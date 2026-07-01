export interface RecorderLevelChannel {
  peak: number
  rms: number
}

export interface RecorderLevel {
  peak: number
  rms: number
  channels: RecorderLevelChannel[]
}

export interface RecorderLevelEvent {
  level: RecorderLevel
}
