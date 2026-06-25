import type { PcmBufferSnapshot } from "@/buffer/types"
import type { RecorderController } from "@/core/recorder-controller"
import type {
  RecorderPluginEventContext,
  RecorderPluginEventPayload,
} from "@/plugins/types"
import type { RecorderStorageOptions } from "@/storage/types"
import type { PcmExportOptions, PcmExportResult } from "@/codecs/base/pcm-types"
import type { WavExportOptions, WavExportResult } from "@/codecs/base/wav-types"
import type { Mp3ExportOptions, Mp3ExportResult } from "@/codecs/mp3/types"

/**
 * 音频声道数。支持任意正整数，常见值：
 * - 1: 单声道
 * - 2: 立体声
 * - 6: 5.1 环绕声
 * - 8: 7.1 环绕声
 * 实际支持的声道数取决于硬件设备和编码器能力。
 */
export type AudioChannelCount = number

/** 三种底层采集链路。auto 由 createInputGraph 按兼容性逐级降级选择。 */
export type RecorderInputStrategy =
  | "media-recorder"
  | "audio-worklet"
  | "script-processor"

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
  FrameLossDetected = "frame-loss-detected",
  MediaRecorderFallback = "media-recorder-fallback",
  AudioConstraintNotApplied = "audio-constraint-not-applied",
}

export enum RecorderInputSource {
  Microphone = "microphone",
  ExternalStream = "external-stream",
}

/**
 * 录音输入参数。所有字段均可选，未传字段走 createRecorder 时的默认值，
 * createRecorder 也未传的字段在 open() 内部使用合理默认值。
 */
export interface RecorderInputOptions {
  sampleRate?: number
  channelCount?: AudioChannelCount
  echoCancellation?: boolean // 默认 true
  noiseSuppression?: boolean // 默认 true
  autoGainControl?: boolean // 默认 true
  /** 指定麦克风设备 ID，对应 enumerateDevices 返回的 deviceId */
  deviceId?: string
  /** 默认 false（开启丢帧补偿）；传 true 禁用静音填补，但检测和 warning 仍会触发 */
  frameLossCompensation?: boolean
  /**
   * 采集链路选择。默认 "auto"：优先 MediaRecorder，按兼容性降级到
   * AudioWorklet / ScriptProcessor。也可显式指定某一种；该模式不可用时
   * 发降级 warning 后自动降级到下一个可用模式。
   */
  inputStrategy?: "auto" | RecorderInputStrategy
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
  /** 实际使用的采集链路，open() 成功后写入（为实际值，非能力预测值） */
  inputStrategy?: RecorderInputStrategy
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
  "frame:async": RecorderFrameEvent
  issue: RecorderIssueEvent
  "plugin:level": RecorderPluginEventContext<RecorderLevelEvent>
  [event: string]:
    | RecorderPluginEventContext<RecorderPluginEventPayload>
    | RecorderStateChangeEvent
    | RecorderFrameEvent
    | RecorderIssueEvent
}

/**
 * open() 配置。展平为录音输入参数，无需嵌套 capture 层。
 * open() 传入的字段优先级高于 createRecorder 时的 input 默认值。
 */
export type RecorderOpenOptions = RecorderInputOptions

/**
 * createRecorder() 配置。所有字段均可选，最简用法 createRecorder() 无参即可。
 * 录音输入参数直接平铺，open() 时若不传对应字段则使用此处配置。
 */
export interface CreateRecorderOptions extends RecorderInputOptions {
  storage?: RecorderStorageOptions
  encoders?: SnapshotEncoderDefinition[]
}

/**
 * 快照编码器定义。每种格式（pcm / wav / mp3 / 未来扩展）通过实现该接口，
 * 以依赖注入的方式传给 createRecorder({ encoders: [...] }) 或
 * recorder.registerEncoder(...)，而非内置在库中隐式注册。
 */
export interface SnapshotEncoderDefinition<
  TType extends string = string,
  TOptions = unknown,
  TResult = unknown,
> {
  type: TType
  export(
    snapshot: PcmBufferSnapshot,
    options?: TOptions
  ): Promise<TResult>
}

/**
 * Discriminated union map that links encoder names to their option/result
 * types, enabling fully type-safe `export()` calls without casting at call sites.
 */
export interface EncoderMap {
  pcm: { options: PcmExportOptions; result: PcmExportResult }
  wav: { options: WavExportOptions; result: WavExportResult }
  mp3: { options: Mp3ExportOptions; result: Mp3ExportResult }
}
