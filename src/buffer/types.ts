import type { AudioChannelCount, AudioFrame } from "@/types"

export type MaybePromise<T> = T | Promise<T>

export interface PcmBufferSnapshot {
  sampleRate: number
  channels: AudioChannelCount
  frameCount: number
  durationMs: number
  planar: Int16Array[]
}

export interface PcmBufferStore {
  initialize?(): MaybePromise<void>
  appendFrame(frame: AudioFrame): void
  snapshot(): MaybePromise<PcmBufferSnapshot | undefined>
  clear(): MaybePromise<void>
}
