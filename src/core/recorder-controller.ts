import type { CaptureAdapter, CaptureSession } from "@/capture/types"
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

  constructor(options: { captureAdapter: CaptureAdapter }) {
    this.captureAdapter = options.captureAdapter
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

    try {
      // 控制器不直接接触 Web Audio 细节，只通过适配器接收统一的帧/告警/错误回调。
      this.captureSession = await this.captureAdapter.open(options, {
        onFrame: (frame) => this.handleFrame(frame),
        onIssue: (issue) => this.handleIssue(issue),
      })
    } catch (error) {
      const wrappedError =
        error instanceof Error ? error : new Error("Failed to open recorder.")
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

    return this.getRuntimeInfo()
  }

  pause(): void {
    this.assertState([RecorderState.Recording])
    // pause 不销毁底层图，只停止接收帧并切换状态，便于后续 resume。
    this.requireSession().pause()
    this.transition(RecorderState.Paused)
  }

  async resume(): Promise<RecorderRuntimeInfo> {
    this.assertState([RecorderState.Paused])
    const session = this.requireSession()

    await session.resume()
    this.syncRuntimeFromSession(session)
    this.transition(RecorderState.Recording)

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

    return this.getLatestSummary()
  }

  async close(): Promise<void> {
    this.assertState([
      RecorderState.Ready,
      RecorderState.Recording,
      RecorderState.Paused,
      RecorderState.Stopped,
    ])

    if (this.captureSession) {
      // close 会关闭底层采集图和可能由适配器持有的 MediaStream。
      await this.captureSession.close()
      this.captureSession = undefined
    }

    this.transition(RecorderState.Closed)
  }

  async destroy(): Promise<void> {
    if (this.captureSession) {
      await this.captureSession.close()
      this.captureSession = undefined
    }

    // destroy 代表控制器实例退出，不再允许保留任何事件订阅。
    this.transition(RecorderState.Destroyed)
    this.eventBus.clear()
  }

  private handleFrame(frame: AudioFrame): void {
    // 每一帧都顺带推进实时摘要，UI 和后续编码模块都可以只读 summary 获取累计结果。
    this.sessionRuntimeInfo = {
      ...this.sessionRuntimeInfo,
      actualSampleRate: frame.sampleRate,
      actualChannelCount: frame.channels,
    }
    this.latestSessionSummary = {
      ...this.latestSessionSummary,
      frames: this.latestSessionSummary.frames + 1,
      durationMs: this.latestSessionSummary.durationMs + frame.durationMs,
      sampleRate: frame.sampleRate,
      channels: frame.channels,
    }
    this.eventBus.emit("frame", this.createFrameEvent(frame))
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
