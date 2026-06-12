import type { CaptureAdapter, CaptureSession } from "../capture/types"
import { RecorderInputSource, RecorderState } from "../types"
import { EventBus } from "./event-bus"
import type {
  AudioFrame,
  RecorderErrorEvent,
  RecorderEventMap,
  RecorderFrameEvent,
  RecorderOpenOptions,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
  RecorderStateChangeEvent,
  RecorderWarning,
  RecorderWarningEvent,
} from "../types"

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
    this.assertState([RecorderState.Idle, RecorderState.Closed])

    const requestedChannelCount = options.capture?.channelCount ?? 1
    this.activeSessionId = this.createSessionId()
    this.sessionRuntimeInfo = {
      requestedChannelCount,
      source: options.sourceStream
        ? RecorderInputSource.ExternalStream
        : RecorderInputSource.Microphone,
    }
    if (options.capture?.sampleRate !== undefined) {
      this.sessionRuntimeInfo.requestedSampleRate = options.capture.sampleRate
    }
    this.latestSessionSummary = {
      frames: 0,
      durationMs: 0,
      sampleRate: 0,
      channels: requestedChannelCount,
    }

    try {
      this.captureSession = await this.captureAdapter.open(options, {
        onFrame: (frame) => this.handleFrame(frame),
        onWarning: (warning) => this.emitWarning(warning),
        onError: (error) => this.emitError(error),
      })
    } catch (error) {
      const wrappedError =
        error instanceof Error ? error : new Error("Failed to open recorder.")
      this.emitError(wrappedError)
      throw wrappedError
    }

    this.sessionRuntimeInfo = {
      ...this.sessionRuntimeInfo,
      actualSampleRate: this.captureSession.actualSampleRate,
      actualChannelCount: this.captureSession.actualChannelCount,
    }
    this.latestSessionSummary = {
      ...this.latestSessionSummary,
      sampleRate: this.captureSession.actualSampleRate,
      channels: this.captureSession.actualChannelCount,
    }
    this.transition(RecorderState.Ready)

    return this.getRuntimeInfo()
  }

  async start(): Promise<RecorderRuntimeInfo> {
    this.assertState([RecorderState.Ready])
    const session = this.requireSession()

    await session.start()
    this.sessionRuntimeInfo = {
      ...this.sessionRuntimeInfo,
      actualSampleRate: session.actualSampleRate,
      actualChannelCount: session.actualChannelCount,
    }
    this.transition(RecorderState.Recording)

    return this.getRuntimeInfo()
  }

  pause(): void {
    this.assertState([RecorderState.Recording])
    this.requireSession().pause()
    this.transition(RecorderState.Paused)
  }

  async resume(): Promise<RecorderRuntimeInfo> {
    this.assertState([RecorderState.Paused])
    const session = this.requireSession()

    await session.resume()
    this.sessionRuntimeInfo = {
      ...this.sessionRuntimeInfo,
      actualSampleRate: session.actualSampleRate,
      actualChannelCount: session.actualChannelCount,
    }
    this.transition(RecorderState.Recording)

    return this.getRuntimeInfo()
  }

  async stop(): Promise<RecorderSessionSummary> {
    this.assertState([RecorderState.Recording, RecorderState.Paused])
    const session = this.requireSession()
    const summary = await session.stop()

    this.latestSessionSummary = {
      ...this.latestSessionSummary,
      frames: summary.frames,
      durationMs: summary.durationMs,
      sampleRate: session.actualSampleRate,
      channels: session.actualChannelCount,
    }
    this.sessionRuntimeInfo = {
      ...this.sessionRuntimeInfo,
      actualSampleRate: session.actualSampleRate,
      actualChannelCount: session.actualChannelCount,
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

    this.transition(RecorderState.Destroyed)
    this.eventBus.clear()
  }

  private handleFrame(frame: AudioFrame): void {
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
    const event: RecorderStateChangeEvent = {
      controller: this,
      sessionId: this.activeSessionId,
      emittedAt: Date.now(),
      previousState,
      state: nextState,
      runtimeInfo: this.getRuntimeInfo(),
      summary: this.getLatestSummary(),
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
      controller: this,
      sessionId: this.activeSessionId,
      emittedAt: Date.now(),
      frame,
      runtimeInfo: this.getRuntimeInfo(),
      summary: this.getLatestSummary(),
    }
  }

  private emitWarning(warning: RecorderWarning): void {
    const event: RecorderWarningEvent = {
      controller: this,
      sessionId: this.activeSessionId,
      emittedAt: Date.now(),
      warning,
      runtimeInfo: this.getRuntimeInfo(),
      summary: this.getLatestSummary(),
    }
    this.eventBus.emit("warning", event)
  }

  private emitError(error: Error): void {
    const event: RecorderErrorEvent = {
      controller: this,
      sessionId: this.activeSessionId,
      emittedAt: Date.now(),
      error,
      runtimeInfo: this.getRuntimeInfo(),
      summary: this.getLatestSummary(),
    }
    this.eventBus.emit("error", event)
  }

  private createSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}
