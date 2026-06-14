import type { CaptureAdapter } from "@/capture/types"
import type { RecorderController } from "@/core/recorder-controller"
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

export interface RecorderEventMap {
  statechange: RecorderStateChangeEvent
  frame: RecorderFrameEvent
  issue: RecorderIssueEvent
}

export interface RecorderOpenOptions {
  sourceStream?: MediaStream
  capture?: AudioCaptureOptions
}

export interface CreateRecorderOptions {
  captureAdapter?: CaptureAdapter
  storage?: RecorderStorageOptions
}
