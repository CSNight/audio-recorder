import { createPcmBufferStore } from "@/buffer/pcm-buffer-store"
import type { RecorderInputAdapter, RecorderInputSession } from "@/input/types"
import { checkRecorderCapability } from "@/input/capability-check"
import type {
  AudioFrame,
  EncoderMap,
  RecorderEventMap,
  RecorderFrameEvent,
  RecorderInputOptions,
  RecorderIssue,
  RecorderIssueEvent,
  RecorderOpenOptions,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
  RecorderStateChangeEvent,
  ExportEncoderDefinition,
} from "@/types"
import {
  RecorderInputSource,
  RecorderState,
  RecorderWarningCode,
} from "@/types"
import { PcmFramePipeline } from "@/pipeline/pcm-frame-pipeline"
import type { RecorderFramePipeline } from "@/pipeline/types"
import { PluginHost } from "@/plugins/plugin-host"
import type { RecorderPlugin } from "@/plugins/types"
import type { RecorderStorageOptions } from "@/storage/types"
import { EventBus } from "@/core/event-bus"

/**
 * 录音控制器核心类，管理录音会话的完整生命周期。
 *
 * 状态机：Idle → Ready → Recording ⇄ Paused → Stopped → Closed → (Idle)
 * 任意状态均可调用 destroy() 进入 Destroyed 终态。
 *
 * 主要职责：
 * - 通过 RecorderInputAdapter 打开麦克风 / 外部流输入
 * - 将 PCM 帧写入 RecorderFramePipeline（含缓冲与持久化）
 * - 驱动 PluginHost 分发生命周期钩子和插件事件
 * - 提供 exportEncoded() 统一导出接口，支持 PCM / WAV / MP3 等多格式
 * - 通过 EventBus 向外广播 statechange / frame:async / issue 等事件
 */
export class RecorderController {
  private readonly eventBus = new EventBus<RecorderEventMap>()
  private readonly inputAdapter: RecorderInputAdapter
  private readonly encoders = new Map<string, ExportEncoderDefinition>()
  private readonly pluginHost = new PluginHost({
    recorder: this,
    emitIssue: (issue) => this.handleIssue(issue),
    getRuntimeInfo: () => this.getRuntimeInfo(),
    getLatestSummary: () => this.getLatestSummary(),
    createEventContext: () => this.createEventContext(),
  })
  private readonly storageOptions: RecorderStorageOptions | undefined
  private readonly defaultInput: RecorderInputOptions
  private framePipeline: RecorderFramePipeline
  private inputSession: RecorderInputSession | undefined
  private activeSessionId = "session-0"
  private recorderState: RecorderState = RecorderState.Idle
  private hasAsyncFrameListeners = false
  private sessionRuntimeInfo: RecorderRuntimeInfo = {
    requestedChannelCount: 1,
    source: RecorderInputSource.Microphone,
  }
  private latestSessionSummary: RecorderSessionSummary = {
    frames: 0,
    durationMs: 0,
    sampleRate: 0,
    channels: 1,
  }

  constructor(options: {
    inputAdapter: RecorderInputAdapter
    storageOptions: RecorderStorageOptions | undefined
    defaultInput?: RecorderInputOptions
    framePipeline?: RecorderFramePipeline
    encoders?: ExportEncoderDefinition[]
  }) {
    this.inputAdapter = options.inputAdapter
    options.encoders?.forEach((e) => this.encoders.set(e.type, e))
    this.storageOptions = options.storageOptions
    this.defaultInput = options.defaultInput ?? {}
    this.framePipeline = options.framePipeline ?? new PcmFramePipeline()
  }

  on<TKey extends keyof RecorderEventMap>(
    event: TKey,
    listener: (payload: RecorderEventMap[TKey]) => void
  ): () => void {
    if (typeof event === "string" && event.startsWith("plugin:")) {
      return this.pluginHost.on(
        event,
        listener as (
          payload: import("@/plugins/types").RecorderPluginEventContext<
            import("@/plugins/types").RecorderPluginEventPayload
          >
        ) => void
      )
    }
    return this.eventBus.on(event, listener)
  }

  off<TKey extends keyof RecorderEventMap>(
    event: TKey,
    listener: (payload: RecorderEventMap[TKey]) => void
  ): void {
    if (typeof event === "string" && event.startsWith("plugin:")) {
      this.pluginHost.off(
        event,
        listener as (
          payload: import("@/plugins/types").RecorderPluginEventContext<
            import("@/plugins/types").RecorderPluginEventPayload
          >
        ) => void
      )
      return
    }
    this.eventBus.off(event, listener)
  }

  getState(): RecorderState {
    return this.recorderState
  }

  getRuntimeInfo(): RecorderRuntimeInfo {
    return { ...this.sessionRuntimeInfo }
  }

  getLatestSummary(): RecorderSessionSummary {
    return { ...this.latestSessionSummary }
  }

  async use(plugin: RecorderPlugin): Promise<void> {
    if (this.recorderState === RecorderState.Destroyed) {
      throw new Error(
        'Recorder state "destroyed" does not allow this operation. Expected: idle, ready, recording, paused, stopped, closed.'
      )
    }

    await this.pluginHost.use(plugin)
  }

  registerEncoder<TType extends string, TOptions, TResult>(
    definition: ExportEncoderDefinition<TType, TOptions, TResult>
  ): void {
    if (this.recorderState === RecorderState.Destroyed) {
      throw new Error(
        'Recorder state "destroyed" does not allow this operation. Expected: idle, ready, recording, paused, stopped, closed.'
      )
    }

    if (this.encoders.has(definition.type)) {
      throw new Error(
        `Recorder encoder "${definition.type}" is already registered.`
      )
    }
    this.encoders.set(definition.type, definition as ExportEncoderDefinition)
  }

  /**
   * 通用快照编码导出入口：所有格式（pcm / wav / mp3 / 未来扩展）统一走这一个方法。
   */
  exportEncoded<TKey extends keyof EncoderMap>(
    type: TKey,
    options?: EncoderMap[TKey]["options"]
  ): Promise<EncoderMap[TKey]["result"]>

  exportEncoded<TOptions, TResult>(
    type: string,
    options?: TOptions
  ): Promise<TResult>

  exportEncoded(type: string, options?: unknown): Promise<unknown> {
    return this.requirePcmSnapshot().then(async (snapshot) => {
      const encoder = this.encoders.get(type)
      if (!encoder) {
        throw new Error(
          `Recorder encoder "${type}" is not registered. Pass it via createRecorder({ encoders: [...] }) or recorder.registerEncoder(...).`
        )
      }
      await encoder.preload?.()
      return encoder.export(snapshot, options)
    })
  }

  async open(options: RecorderOpenOptions = {}): Promise<RecorderRuntimeInfo> {
    this.assertState([RecorderState.Idle, RecorderState.Closed])

    // sourceStream 是内部字段，从扩展选项中提取后单独传给 adapter
    const { sourceStream, ...inputOptions } = options as RecorderOpenOptions & {
      sourceStream?: MediaStream
    }

    // open() 字段优先，未传的 fallback 到 createRecorder 时存储的默认值
    const mergedInput: RecorderInputOptions = {
      ...this.defaultInput,
      ...inputOptions,
    }

    const requestedChannelCount = mergedInput.channelCount ?? 1
    const prevSessionId = this.activeSessionId
    this.activeSessionId = this.createSessionId()

    // 能力预检：若预测走 ScriptProcessor，提前同步上报 warning，无需等到 worklet 失败
    const capability = checkRecorderCapability()
    if (capability.expectedInputStrategy === "script-processor") {
      this.handleIssue({
        kind: "warning",
        warning: {
          code: RecorderWarningCode.ScriptProcessorFallback,
          message:
            "AudioWorklet is not supported in this browser. ScriptProcessor will be used as fallback.",
        },
      })
    }

    this.sessionRuntimeInfo = {
      requestedChannelCount,
      source: sourceStream
        ? RecorderInputSource.ExternalStream
        : RecorderInputSource.Microphone,
      ...(mergedInput.sampleRate !== undefined && {
        requestedSampleRate: mergedInput.sampleRate,
      }),
    }
    this.latestSessionSummary = {
      frames: 0,
      durationMs: 0,
      sampleRate: 0,
      channels: requestedChannelCount,
    }
    await this.framePipeline.reset()
    this.framePipeline = this.createFramePipeline()
    await this.framePipeline.initialize?.()

    try {
      this.inputSession = await this.inputAdapter.open(
        { input: mergedInput, ...(sourceStream && { sourceStream }) },
        {
          onFrame: (frame) => this.handleFrame(frame),
          onIssue: (issue) => this.handleIssue(issue),
        }
      )
    } catch (error) {
      const wrappedError =
        error instanceof Error ? error : new Error("Failed to open recorder.")
      await Promise.resolve(this.framePipeline.reset()).catch(() => undefined)
      this.framePipeline = new PcmFramePipeline()
      this.activeSessionId = prevSessionId
      this.handleIssue({
        kind: "error",
        error: wrappedError,
      })
      throw wrappedError
    }

    this.syncRuntimeFromSession(this.inputSession)
    // 上报实际建立的采集链路（来自所选 InputBackend），而非能力预测值
    this.sessionRuntimeInfo.inputStrategy =
      this.inputSession.actualInputStrategy
    this.latestSessionSummary = {
      ...this.latestSessionSummary,
      sampleRate: this.inputSession.actualSampleRate,
      channels: this.inputSession.actualChannelCount,
    }
    this.transition(RecorderState.Ready)

    return this.getRuntimeInfo()
  }

  async start(): Promise<RecorderRuntimeInfo> {
    this.assertState([RecorderState.Ready])
    const session = this.requireSession()

    // 每次录音开始时检测一次，避免热路径每帧都查
    this.hasAsyncFrameListeners = this.eventBus.listenerCount("frame:async") > 0

    await session.start()
    this.syncRuntimeFromSession(session)
    this.transition(RecorderState.Recording)
    this.pluginHost.onStart()

    return this.getRuntimeInfo()
  }

  pause(): void {
    this.assertState([RecorderState.Recording])
    this.requireSession().pause()
    this.transition(RecorderState.Paused)
    this.pluginHost.onPause()
  }

  async resume(): Promise<RecorderRuntimeInfo> {
    this.assertState([RecorderState.Paused])
    const session = this.requireSession()

    await session.resume()
    this.syncRuntimeFromSession(session)
    this.transition(RecorderState.Recording)
    this.pluginHost.onResume()

    return this.getRuntimeInfo()
  }

  async stop(): Promise<RecorderSessionSummary> {
    this.assertState([RecorderState.Recording, RecorderState.Paused])
    const session = this.requireSession()
    const summary = await session.stop()

    this.syncRuntimeFromSession(session)
    this.latestSessionSummary = {
      ...this.latestSessionSummary,
      frames: summary.frames,
      durationMs: summary.durationMs,
      sampleRate: session.actualSampleRate,
      channels: session.actualChannelCount,
    }
    this.transition(RecorderState.Stopped)
    this.pluginHost.onStop()

    return this.getLatestSummary()
  }

  async close(): Promise<void> {
    this.assertState([
      RecorderState.Ready,
      RecorderState.Recording,
      RecorderState.Paused,
      RecorderState.Stopped,
    ])

    if (
      this.recorderState === RecorderState.Recording ||
      this.recorderState === RecorderState.Paused
    ) {
      const session = this.requireSession()
      await session.stop()
      this.transition(RecorderState.Stopped)
      this.pluginHost.onStop()
    }

    if (this.inputSession) {
      await this.inputSession.close()
      this.inputSession = undefined
    }
    await this.framePipeline.reset()

    this.transition(RecorderState.Closed)
  }

  async destroy(): Promise<void> {
    if (this.inputSession) {
      await this.inputSession.close()
      this.inputSession = undefined
    }
    await this.framePipeline.reset()

    this.transition(RecorderState.Destroyed)
    await this.pluginHost.destroy()
    this.eventBus.clear()
  }

  private handleFrame(frame: AudioFrame): void {
    this.framePipeline.acceptFrame(frame)
    this.sessionRuntimeInfo.actualSampleRate = frame.sampleRate
    this.sessionRuntimeInfo.actualChannelCount = frame.channels
    this.latestSessionSummary.frames += 1
    this.latestSessionSummary.durationMs += frame.durationMs
    this.latestSessionSummary.sampleRate = frame.sampleRate
    this.latestSessionSummary.channels = frame.channels
    this.pluginHost.onFrame(frame)

    if (this.hasAsyncFrameListeners) {
      const event = this.createFrameEvent(frame)
      queueMicrotask(() => {
        this.eventBus.emit("frame:async", event)
      })
    }
  }

  private transition(nextState: RecorderState): void {
    if (this.recorderState === nextState) {
      return
    }

    const previousState = this.recorderState
    this.recorderState = nextState
    const event: RecorderStateChangeEvent = {
      previousState,
      state: nextState,
      ...this.createEventContext(),
    }
    this.eventBus.emit("statechange", event)
  }

  private requireSession(): RecorderInputSession {
    if (!this.inputSession) {
      throw new Error("Recorder session is not open.")
    }

    return this.inputSession
  }

  private async requirePcmSnapshot() {
    const snapshot = await this.framePipeline.getSnapshot()
    if (!snapshot) {
      throw new Error("Recorder has no PCM data to export.")
    }

    return snapshot
  }

  private createFramePipeline(): RecorderFramePipeline {
    return new PcmFramePipeline(
      createPcmBufferStore({
        sessionId: this.activeSessionId,
        startedAt: Date.now(),
        storage: this.storageOptions,
        emitIssue: (issue) => this.handleIssue(issue),
      })
    )
  }

  private assertState(allowedStates: RecorderState[]): void {
    if (allowedStates.includes(this.recorderState)) {
      return
    }

    throw new Error(
      `Recorder state "${this.recorderState}" does not allow this operation. Expected: ${allowedStates.join(", ")}.`
    )
  }

  private createFrameEvent(frame: AudioFrame): RecorderFrameEvent {
    return {
      frame,
      ...this.createEventContext(),
    }
  }

  private handleIssue(issue: RecorderIssue): void {
    if (issue.kind === "warning") {
      console.warn(
        `[@csnight/audio-recorder][${issue.warning.code}] ${issue.warning.message}`
      )
    }

    const event: RecorderIssueEvent = {
      issue,
      ...this.createEventContext(),
    }
    this.eventBus.emit("issue", event)
  }

  private syncRuntimeFromSession(session: RecorderInputSession): void {
    this.sessionRuntimeInfo = {
      ...this.sessionRuntimeInfo,
      actualSampleRate: session.actualSampleRate,
      actualChannelCount: session.actualChannelCount,
    }
  }

  private createEventContext(): {
    controller: RecorderController
    sessionId: string
    emittedAt: number
    runtimeInfo: RecorderRuntimeInfo
    summary: RecorderSessionSummary
  } {
    return {
      controller: this,
      sessionId: this.activeSessionId,
      emittedAt: Date.now(),
      runtimeInfo: this.getRuntimeInfo(),
      summary: this.getLatestSummary(),
    }
  }

  private createSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}
