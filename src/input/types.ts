import type { AudioFrame, RecorderInputStrategy, RecorderIssue } from "../types"

export interface RecorderInputHandlers {
  onFrame: (frame: AudioFrame) => void
  onIssue: (issue: RecorderIssue) => void
}

export interface RecorderInputRequest {
  sourceStream?: MediaStream | undefined
  input?: import("../types").RecorderInputOptions | undefined
}

export interface InputSessionSummary {
  frames: number
  durationMs: number
}

export interface RecorderInputSession {
  readonly actualSampleRate: number
  readonly actualChannelCount: number
  /** 实际建立的采集链路（来自所选 InputBackend） */
  readonly actualInputStrategy: RecorderInputStrategy
  start(): Promise<void>
  pause(): void
  resume(): Promise<void>
  stop(): Promise<InputSessionSummary>
  close(): Promise<void>
}

export interface RecorderInputAdapter {
  open(
    request: RecorderInputRequest,
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession>
}
