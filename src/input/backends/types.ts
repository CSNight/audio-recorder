import type { InputIssue } from "@/input/types"
import type { AudioChannelCount, RecorderInputStrategy } from "@/types"

/**
 * 原始 float planar 帧的接收方。由 BrowserInputSession 实现，
 * InputBackend 解析出每帧后调用，session 负责状态门控、丢帧补偿与 Int16 转换。
 */
export interface InputFrameSink {
  acceptFrame: (planar: readonly Float32Array[], timestamp: number) => void
}

/**
 * 单一采集链路的运行时句柄。三种实现（MediaRecorder / AudioWorklet /
 * ScriptProcessor）生命周期完全一致：创建即已接好流并开始产帧，
 * suspend/resume 控制产帧，dispose 永久拆除。
 */
export interface InputBackend {
  /** 该 backend 对应的采集链路，写入 runtimeInfo.inputStrategy */
  readonly strategy: RecorderInputStrategy
  /** 暂停产帧。MediaRecorder → mr.pause()；worklet/SP 无操作（由 sink 门控） */
  suspend: () => void
  /** 恢复产帧。MediaRecorder → mr.resume() */
  resume: () => void
  /** 永久拆除：停止 recorder / 断开图 / 释放节点与回调 */
  dispose: () => void
}

/** backend 工厂入参：已就绪的 AudioContext、流、目标声道数、帧接收方与告警出口。 */
export interface InputBackendContext {
  audioContext: AudioContext
  stream: MediaStream
  channelCount: AudioChannelCount
  sink: InputFrameSink
  emitIssue: (issue: InputIssue) => void
}

/**
 * backend 工厂统一签名。当前环境/流不支持该链路时抛
 * InputBackendUnavailableError，由 selectInputBackend 捕获并降级到下一个。
 */
export type InputBackendFactory = (
  context: InputBackendContext
) => Promise<InputBackend>

/** 语义化降级信号：backend 无法在当前环境建立时抛出，触发选择器尝试下一个。 */
export class InputBackendUnavailableError extends Error {
  constructor(
    readonly strategy: RecorderInputStrategy,
    message: string
  ) {
    super(message)
    this.name = "InputBackendUnavailableError"
  }
}
