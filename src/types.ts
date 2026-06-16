import type { CaptureAdapter } from "@/capture/types"
import type { RecorderController } from "@/core/recorder-controller"
import type {
  RecorderPluginEventContext,
  RecorderPluginEventPayload,
} from "@/plugins/types"
import type { RecorderStorageOptions } from "@/storage/types"

export type AudioChannelCount = 1 | 2

export enum RecorderState {
  Idle = "idle",
  Ready = "ready",
  Recording = "recording",
  Paused = "paused",
  Stopped = "stopped",
  Closed = "closed",
  Destroyed = "destroyed",
}

export enum RecorderWarningCode {
  ScriptProcessorFallback = "script-processor-fallback",
  ChannelCountAdjusted = "channel-count-adjusted",
  PersistencePluginMissing = "persistence-plugin-missing",
  PersistencePluginUnavailable = "persistence-plugin-unavailable",
  PersistenceActivationFailed = "persistence-activation-failed",
}

export enum RecorderInputSource {
  Microphone = "microphone",
  ExternalStream = "external-stream",
}

export enum CaptureSessionState {
  Ready = "ready",
  Recording = "recording",
  Paused = "paused",
  Stopped = "stopped",
  Closed = "closed",
}

export interface AudioCaptureOptions {
  sampleRate?: number
  channelCount?: AudioChannelCount
  echoCancellation?: boolean
  noiseSuppression?: boolean
  autoGainControl?: boolean
  /** 指定麦克风设备 ID，对应 enumerateDevices 返回的 deviceId */
  deviceId?: string
}

/** 麦克风（音频输入）设备描述，由 listMicrophoneDevices() 返回。 */
export interface AudioInputDevice {
  deviceId: string
  label: string
  groupId: string
}

export interface AudioFrame {
  channels: AudioChannelCount
  sampleRate: number
  timestamp: number
  durationMs: number
  planar: Int16Array[]
}

export interface RecorderWarning {
  code: RecorderWarningCode
  message: string
}

export type RecorderIssue =
  | {
      kind: "warning"
      warning: RecorderWarning
    }
  | {
      kind: "error"
      error: Error
    }

export interface RecorderRuntimeInfo {
  requestedSampleRate?: number
  actualSampleRate?: number
  requestedChannelCount: AudioChannelCount
  actualChannelCount?: AudioChannelCount
  source: RecorderInputSource
}

export interface RecorderSessionSummary {
  frames: number
  durationMs: number
  sampleRate: number
  channels: AudioChannelCount
}

export interface RecorderStateChangeEvent {
  controller: RecorderController
  sessionId: string
  emittedAt: number
  previousState: RecorderState
  state: RecorderState
  runtimeInfo: RecorderRuntimeInfo
  summary: RecorderSessionSummary
}

export interface RecorderFrameEvent {
  controller: RecorderController
  sessionId: string
  emittedAt: number
  frame: AudioFrame
  runtimeInfo: RecorderRuntimeInfo
  summary: RecorderSessionSummary
}

export interface RecorderIssueEvent {
  controller: RecorderController
  sessionId: string
  emittedAt: number
  issue: RecorderIssue
  runtimeInfo: RecorderRuntimeInfo
  summary: RecorderSessionSummary
}

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

export interface RecorderEventMap {
  statechange: RecorderStateChangeEvent
  frame: RecorderFrameEvent
  issue: RecorderIssueEvent
  level: RecorderPluginEventContext<RecorderLevelEvent>
  [event: string]:
    | RecorderPluginEventContext<RecorderPluginEventPayload>
    | RecorderStateChangeEvent
    | RecorderFrameEvent
    | RecorderIssueEvent
}

export interface RecorderOpenOptions {
  sourceStream?: MediaStream
  capture?: AudioCaptureOptions
}

export interface CreateRecorderOptions {
  captureAdapter?: CaptureAdapter
  storage?: RecorderStorageOptions
}
