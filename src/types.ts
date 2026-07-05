import type { PcmBufferSnapshot } from "./buffer/types"
import type { RecorderController } from "./core/recorder-controller"
import type { DtmfDetectEvent } from "./plugins/dtmf"
import type { FrequencyFftEvent } from "./plugins/frequency-histogram"
import type { RecorderLevelEvent } from "./plugins/level-meter"
import type { RecorderPluginEventContext } from "./plugins/types"
import type { RecorderStorageOptions } from "./storage"
import type {
  PcmExportOptions,
  PcmExportResult,
  WavExportOptions,
  WavExportResult,
} from "./codecs/base"
import type { Mp3ExportOptions, Mp3ExportResult } from "./codecs/mp3"
import type { FlacExportOptions, FlacExportResult } from "./codecs/flac"
import type { OpusExportOptions, OpusExportResult } from "./codecs/opus"
import type { G711ExportOptions, G711ExportResult } from "./codecs/g711"
import type { AacExportOptions, AacExportResult } from "./codecs/aac"
import type { AmrExportOptions, AmrExportResult } from "./codecs/amr"
import type { Ac3ExportOptions, Ac3ExportResult } from "./codecs/ac3"

export interface EncodedAudioChunk {
  format: string
  sampleRate: number
  channels: number
  chunk: Uint8Array
}

export interface DecodedAudioChunk {
  sampleRate: number
  channels: number
  planar: Float32Array[]
}

export interface AudioDecoderDefinition {
  format: string
  decode(chunk: EncodedAudioChunk): Promise<DecodedAudioChunk>
}

/** 标准流式数据包 payload，通过 "plugin:stream" 事件发出。 */
export interface StreamingPacketPayload {
  /** 逻辑流 ID；同一条流跨重连/重开可保持稳定。 */
  streamId: string
  /** 区分不同流式导出会话的 ID，也用于跨端传输和缓存索引。 */
  sessionId: string
  seq: number
  timestampMs: number
  durationMs: number
  sampleRate: number
  channels: number
  format: string
  chunk: Uint8Array
  /** true 表示本次 session 的最后一个 packet（flush 产物）。 */
  isFinal: boolean
  /** 标记当前 packet 前后存在不连续片段，供传输和播放端处理 gap。 */
  discontinuity?: boolean
  /** 预留扩展字段，避免后续为 transport-neutral 元数据频繁破坏类型。 */
  metadata?: Record<string, unknown>
}

export type StreamingExportFormat = string

/**
 * StreamEncoder：编码分片逻辑的统一封装，只写一次，Worker 和主线程共用。
 * 不持有任何浏览器 API 引用，可安全在 Worker 上下文中执行。
 */
export interface StreamEncoder {
  /** 接收一帧 PCM 数据，返回当前可产出的编码块（无产出时返回 null） */
  feedFrame(
    channels: number,
    sampleRate: number,
    planar: Int16Array[]
  ): Uint8Array | null
  /** 录音结束时冲刷剩余缓冲，返回最终块（无剩余时返回 null） */
  flush(): Uint8Array | null
  /** 释放内部资源 */
  dispose(): void
}

/** StreamEncoder 工厂定义 */
export interface StreamEncoderDefinition<TOptions = unknown> {
  format: string
  /**
   * 可选：为本编码器创建专属 Worker 实例的工厂函数。
   * 未提供时退回主线程同步编码。
   * MP3 等可选编解码器提供此字段，以便将 WASM 模块等重型依赖隔离到独立 Worker blob 中。
   */
  workerFactory?: () => Worker

  /**
   * 【可选】预加载编码器所需资源（如 WASM 模块）。
   * 幂等，可多次调用，内部由单例 Promise 保证只加载一次。
   * 无 WASM 依赖的编码器（PCM/WAV/MP3/G711）无需实现此方法。
   */
  preload?(): Promise<void>

  /**
   * 同步创建 StreamEncoder 实例，可接收格式相关选项（bitrate、framesPerChunk 等）。
   * 对于有 WASM 依赖的编码器，调用前必须已执行 preload()。
   */
  create(options?: TOptions): StreamEncoder
}

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
  channelCount?: number
  echoCancellation?: boolean // 默认 true
  noiseSuppression?: boolean // 默认 true
  autoGainControl?: boolean // 默认 true
  /** 指定麦克风设备 ID，对应 enumerateDevices 返回的 deviceId */
  deviceId?: string
  /**
   * 默认 false（开启丢帧补偿）；传 true 禁用静音填补，但检测和 warning 仍会触发。
   * 命名语义：true = 禁用补偿，false = 启用补偿（默认）。
   */
  disableFrameLossCompensation?: boolean
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
  channels: number
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
  requestedChannelCount: number
  actualChannelCount?: number
  source: RecorderInputSource
  /** 实际使用的采集链路，open() 成功后写入（为实际值，非能力预测值） */
  inputStrategy?: RecorderInputStrategy
}

export interface RecorderSessionSummary {
  frames: number
  durationMs: number
  sampleRate: number
  channels: number
}

export interface RecorderEventContext {
  controller: RecorderController
  sessionId: string
  emittedAt: number
  runtimeInfo: RecorderRuntimeInfo
  summary: RecorderSessionSummary
}

export type EncoderWorkerIncomingMessage =
  | { type: "init"; format: string; options?: unknown }
  | { type: "reset"; options?: unknown }
  | {
      type: "feedFrame"
      planar: Int16Array[]
      channels: number
      sampleRate: number
      seqId: number
    }
  | { type: "flush"; seqId: number }
  | { type: "dispose" }

export type EncoderWorkerOutgoingMessage =
  | { type: "ready" }
  | { type: "result"; result: Uint8Array | null; seqId: number }
  | { type: "error"; message: string; seqId: number }

export interface RecorderStateChangeEvent extends RecorderEventContext {
  previousState: RecorderState
  state: RecorderState
}

export interface RecorderFrameEvent extends RecorderEventContext {
  frame: AudioFrame
}

export interface RecorderIssueEvent extends RecorderEventContext {
  issue: RecorderIssue
}

export interface RecorderEventMap {
  statechange: RecorderStateChangeEvent
  "frame:async": RecorderFrameEvent
  issue: RecorderIssueEvent
  "plugin:level": RecorderPluginEventContext<RecorderLevelEvent>
  "plugin:fft": RecorderPluginEventContext<FrequencyFftEvent>
  "plugin:dtmf:detect": RecorderPluginEventContext<DtmfDetectEvent>
  [event: string]:
    | RecorderPluginEventContext
    | RecorderStateChangeEvent
    | RecorderFrameEvent
    | RecorderIssueEvent
}

/**
 * createRecorder() 配置。所有字段均可选，最简用法 createRecorder() 无参即可。
 * 录音输入参数直接平铺，open() 时若不传对应字段则使用此处配置。
 */
export interface CreateRecorderOptions extends RecorderInputOptions {
  storage?: RecorderStorageOptions
  encoders?: ExportEncoderDefinition[]
}

/**
 * 导出编码器定义。每种格式（pcm / wav / mp3 / 未来扩展）通过实现该接口，
 * 以依赖注入的方式传给 createRecorder({ encoders: [...] }) 或
 * recorder.registerEncoder(...)，而非内置在库中隐式注册。
 */
export interface ExportEncoderDefinition<
  TType extends string = string,
  TOptions = unknown,
  TResult = unknown,
> {
  type: TType
  /**
   * 判断某个采样率是否可被该编码器“直接接受为目标采样率”。
   * 仅用于调用方预判/禁用 UI，不参与导出流程内部决策。
   */
  isSupportSampleRate?(sampleRate: number, options?: TOptions): boolean
  /**
   * 【可选】预加载编码器所需资源（如 WASM 模块）。
   * 幂等，可多次调用，内部由单例 Promise 保证只加载一次。
   * exportEncoded() 在调用 export() 之前会显式 await 此方法。
   */
  preload?(): Promise<void>
  /**
   * 同步执行（所有当前实现均为纯同步计算，无需 Promise 包裹）。
   * 若编码器需要异步资源，应通过 preload() 提前完成，export() 本身保持同步。
   */
  export(snapshot: PcmBufferSnapshot, options?: TOptions): TResult
}

/**
 * Discriminated union map that links encoder names to their option/result
 * types, enabling fully type-safe `export()` calls without casting at call sites.
 */
export interface EncoderMap {
  pcm: { options: PcmExportOptions; result: PcmExportResult }
  wav: { options: WavExportOptions; result: WavExportResult }
  mp3: { options: Mp3ExportOptions; result: Mp3ExportResult }
  flac: { options: FlacExportOptions; result: FlacExportResult }
  ogg: { options: OpusExportOptions; result: OpusExportResult }
  webm: { options: OpusExportOptions; result: OpusExportResult }
  g711: { options: G711ExportOptions; result: G711ExportResult }
  aac: { options: AacExportOptions; result: AacExportResult }
  amr: { options: AmrExportOptions; result: AmrExportResult }
  ac3: { options: Ac3ExportOptions; result: Ac3ExportResult }
  eac3: { options: Ac3ExportOptions; result: Ac3ExportResult }
}
