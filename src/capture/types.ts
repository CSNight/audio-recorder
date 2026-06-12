import type {
  AudioCaptureOptions,
  AudioChannelCount,
  AudioFrame,
  RecorderWarning,
} from "../types"

export interface CaptureHandlers {
  onFrame: (frame: AudioFrame) => void
  onWarning: (warning: RecorderWarning) => void
  onError: (error: Error) => void
}

export interface CaptureOpenRequest {
  sourceStream?: MediaStream
  capture?: AudioCaptureOptions
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
