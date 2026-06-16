import type {
  AudioCaptureOptions,
  AudioChannelCount,
  AudioFrame,
  RecorderWarning,
} from "@/types"

export type CaptureIssue =
  | {
      kind: "warning"
      warning: RecorderWarning
    }
  | {
      kind: "error"
      error: Error
    }

export interface CaptureHandlers {
  onFrame: (frame: AudioFrame) => void
  onIssue: (issue: CaptureIssue) => void
}

export interface CaptureOpenRequest {
  sourceStream?: MediaStream
  capture?: AudioCaptureOptions
  deviceId?: string
}

export interface CaptureSessionSummary {
  frames: number
  durationMs: number
}

export interface CaptureSession {
  readonly actualSampleRate: number
  readonly actualChannelCount: AudioChannelCount
  start(): Promise<void>
  pause(): void
  resume(): Promise<void>
  stop(): Promise<CaptureSessionSummary>
  close(): Promise<void>
}

export interface CaptureAdapter {
  open(
    request: CaptureOpenRequest,
    handlers: CaptureHandlers
  ): Promise<CaptureSession>
}
