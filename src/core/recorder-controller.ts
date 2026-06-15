import { createPcmBufferStore } from "@/buffer/pcm-buffer-store"
import type { CaptureAdapter, CaptureSession } from "@/capture/types"
import type { PcmExportOptions, PcmExportResult } from "@/codecs/pcm/types"
import type { WavExportOptions, WavExportResult } from "@/codecs/wav/types"
import {
  createDefaultEncoderRegistry,
  type EncoderRegistry,
} from "@/encoders/encoder-registry"
import { PcmFramePipeline } from "@/pipeline/pcm-frame-pipeline"
import type { RecorderFramePipeline } from "@/pipeline/types"
import { PluginHost } from "@/plugins/plugin-host"
import type { RecorderPlugin } from "@/plugins/types"
import type { RecorderStorageOptions } from "@/storage/types"
import type {
  AudioFrame,
  RecorderEventMap,
  RecorderFrameEvent,
  RecorderIssue,
  RecorderIssueEvent,
  RecorderOpenOptions,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
  RecorderStateChangeEvent,
} from "@/types"
import { RecorderInputSource, RecorderState } from "@/types"
import { EventBus } from "@/core/event-bus"

export class RecorderController {
  private readonly eventBus = new EventBus<RecorderEventMap>()
  private readonly captureAdapter: CaptureAdapter
  private readonly encoderRegistry: EncoderRegistry
  private readonly pluginHost = new PluginHost({
    recorder: this,
    emitIssue: (issue) => this.handleIssue(issue),
    eventBus: this.eventBus,
    getRuntimeInfo: () => this.getRuntimeInfo(),
    getLatestSummary: () => this.getLatestSummary(),
    createEventContext: () => this.createEventContext(),
  })
  private readonly storageOptions: RecorderStorageOptions | undefined
  private framePipeline: RecorderFramePipeline
  private captureSession: CaptureSession | undefined
  private activeSessionId = "session-0"
  private recorderState: RecorderState = RecorderState.Idle
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
    captureAdapter: CaptureAdapter
    storageOptions: RecorderStorageOptions | undefined
    framePipeline?: RecorderFramePipeline
    encoderRegistry?: EncoderRegistry
  }) {
    this.captureAdapter = options.captureAdapter
    this.encoderRegistry =
      options.encoderRegistry ?? createDefaultEncoderRegistry()
    this.storageOptions = options.storageOptions
    this.framePipeline = options.framePipeline ?? new PcmFramePipeline()
  }

  on<TKey extends keyof RecorderEventMap>(
    event: TKey,
    listener: (payload: RecorderEventMap[TKey]) => void
  ): () => void {
    return this.eventBus.on(event, listener)
  }

  off<TKey extends keyof RecorderEventMap>(
    event: TKey,
    listener: (payload: RecorderEventMap[TKey]) => void
  ): void {
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

  async exportPCM(options: PcmExportOptions = {}): Promise<PcmExportResult> {
    return this.encoderRegistry.export(
      "pcm",
      await this.requirePcmSnapshot(),
      options
    )
  }

  async exportWAV(options: WavExportOptions = {}): Promise<WavExportResult> {
    return this.encoderRegistry.export(
      "wav",
      await this.requirePcmSnapshot(),
      options
    )
  }

  async open(options: RecorderOpenOptions = {}): Promise<RecorderRuntimeInfo> {
    // open 只允许从未打开或已关闭状态进入，确保一次生命周期只绑定一个底层会话。
    this.assertState([RecorderState.Idle, RecorderState.Closed])

    const requestedChannelCount = options.capture?.channelCount ?? 1
    // 每次 open 都生成新的 sessionId，方便事件流、日志和后续导出链路关联同一轮会话。
    this.activeSessionId = this.createSessionId()
    this.sessionRuntimeInfo = {
      requestedChannelCount,
      source: options.sourceStream
        ? RecorderInputSource.ExternalStream
        : RecorderInputSource.Microphone,
      ...(options.capture?.sampleRate !== undefined && {
        requestedSampleRate: options.capture.sampleRate,
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
      // 控制器不直接接触 Web Audio 细节，只通过适配器接收统一的帧/告警/错误回调。
      this.captureSession = await this.captureAdapter.open(options, {
        onFrame: (frame) => this.handleFrame(frame),
        onIssue: (issue) => this.handleIssue(issue),
      })
    } catch (error) {
      const wrappedError =
        error instanceof Error ? error : new Error("Failed to open recorder.")
      // open 失败时回收已初始化的管线（含已打开的持久化会话），避免句柄泄漏。
      await Promise.resolve(this.framePipeline.reset()).catch(() => undefined)
      // Fix #3: restore framePipeline to a clean known-good state so a failed
      // open() does not leave a partially-initialised pipeline behind for the
      // next open() attempt.
      this.framePipeline = new PcmFramePipeline()
      // Fix #12: clear the sessionId that was assigned before initialize() so
      // a failed open() does not leak a dangling session identifier.
      this.activeSessionId = ""
      this.handleIssue({
        kind: "error",
        error: wrappedError,
      })
      throw wrappedError
    }

    // 适配器真正打开后，控制器才回填实际采样率与声道数。
    this.syncRuntimeFromSession(this.captureSession)
    this.latestSessionSummary = {
      ...this.latestSessionSummary,
      sampleRate: this.captureSession.actualSampleRate,
      channels: this.captureSession.actualChannelCount,
    }
    this.transition(RecorderState.Ready)

    return this.getRuntimeInfo()
  }

  async start(): Promise<RecorderRuntimeInfo> {
    // start 只是驱动底层 session，状态和事件出口仍统一收敛在控制器层。
    this.assertState([RecorderState.Ready])
    const session = this.requireSession()

    await session.start()
    this.syncRuntimeFromSession(session)
    this.transition(RecorderState.Recording)
    this.pluginHost.onStart()

    return this.getRuntimeInfo()
  }

  pause(): void {
    this.assertState([RecorderState.Recording])
    // pause 不销毁底层图，只停止接收帧并切换状态，便于后续 resume。
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
    // stop 结束本轮采集但不释放资源，close 才负责真正断开图和释放流。
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

    // Fix #4: if close() is called while recording or paused, the session was
    // never explicitly stopped, so onStop hooks have not been fired yet.
    // Run them now before tearing down the capture graph.
    const wasActive =
      this.recorderState === RecorderState.Recording ||
      this.recorderState === RecorderState.Paused

    if (this.captureSession) {
      // close 会关闭底层采集图和可能由适配器持有的 MediaStream。
      await this.captureSession.close()
      this.captureSession = undefined
    }
    await this.framePipeline.reset()

    if (wasActive) {
      this.pluginHost.onStop()
    }

    this.transition(RecorderState.Closed)
  }

  async destroy(): Promise<void> {
    if (this.captureSession) {
      await this.captureSession.close()
      this.captureSession = undefined
    }
    await this.framePipeline.reset()

    // destroy 代表控制器实例退出，不再允许保留任何事件订阅。
    this.transition(RecorderState.Destroyed)
    await this.pluginHost.destroy()
    this.eventBus.clear()
  }

  private handleFrame(frame: AudioFrame): void {
    // 每一帧都顺带推进实时摘要，UI 和后续编码模块都可以只读 summary 获取累计结果。
    this.framePipeline.acceptFrame(frame)
    // 帧回调是热路径（48kHz worklet 下约 375 次/秒），原地累加而非每帧重建对象，降低 GC 压力。
    this.sessionRuntimeInfo.actualSampleRate = frame.sampleRate
    this.sessionRuntimeInfo.actualChannelCount = frame.channels
    this.latestSessionSummary.frames += 1
    this.latestSessionSummary.durationMs += frame.durationMs
    this.latestSessionSummary.sampleRate = frame.sampleRate
    this.latestSessionSummary.channels = frame.channels
    // 只有存在 frame 监听器时才构建事件对象，无订阅时跳过整套上下文克隆。
    if (this.eventBus.hasListeners("frame")) {
      this.eventBus.emit("frame", this.createFrameEvent(frame))
    }
    this.pluginHost.onFrame(frame)
  }

  private transition(nextState: RecorderState): void {
    if (this.recorderState === nextState) {
      return
    }

    const previousState = this.recorderState
    this.recorderState = nextState
    // 所有状态切换都转成结构化事件，避免 UI 侧自行推测状态机。
    const event: RecorderStateChangeEvent = {
      previousState,
      state: nextState,
      ...this.createEventContext(),
    }
    this.eventBus.emit("statechange", event)
  }

  private requireSession(): CaptureSession {
    if (!this.captureSession) {
      throw new Error("Recorder session is not open.")
    }

    return this.captureSession
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
        `[audio-recorder][${issue.warning.code}] ${issue.warning.message}`
      )
    }

    const event: RecorderIssueEvent = {
      issue,
      ...this.createEventContext(),
    }
    this.eventBus.emit("issue", event)
  }

  private syncRuntimeFromSession(session: CaptureSession): void {
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
    // sessionId 只用于日志追踪和事件关联，不承担安全或全局唯一语义。
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}
