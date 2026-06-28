import type {
  AudioChannelCount,
  AudioFrame,
  RecorderInputStrategy,
  RecorderWarning,
} from "@/types"

/** 输入层向上层传递的问题事件（警告或错误） */
export type InputIssue =
  | {
      kind: "warning"
      warning: RecorderWarning
    }
  | {
      kind: "error"
      error: Error
    }

export interface RecorderInputHandlers {
  onFrame: (frame: AudioFrame) => void
  onIssue: (issue: InputIssue) => void
}

export interface RecorderInputRequest {
  sourceStream?: MediaStream | undefined
  input?: import("@/types").RecorderInputOptions | undefined
}

export interface InputSessionSummary {
  frames: number
  durationMs: number
}

export interface RecorderInputSession {
  readonly actualSampleRate: number
  readonly actualChannelCount: AudioChannelCount
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
