import { describe, expect, it } from "vitest"
import type {
  CaptureAdapter,
  CaptureHandlers,
  CaptureIssue,
  CaptureOpenRequest,
  CaptureSession,
  CaptureSessionSummary,
} from "@/capture/types"
import { RecorderController, RecorderState, RecorderWarningCode } from "@/index"
import type { RecorderPlugin } from "@/plugins/types"
import type { RecorderPersistencePlugin } from "@/storage/types"
import { createAudioFrame } from "@/utils/audio-frame"

class FakeCaptureSession implements CaptureSession {
  // 伪 session 只保留控制器关心的最小行为，用于隔离浏览器音频实现细节。
  private readonly summary: CaptureSessionSummary = {
    frames: 0,
    durationMs: 0,
  }
  closeCalls = 0

  constructor(
    private readonly handlers: CaptureHandlers,
    public readonly actualSampleRate: number,
    public readonly actualChannelCount: 1 | 2
  ) {}

  async start(): Promise<void> {}

  pause(): void {}

  async resume(): Promise<void> {}

  async stop(): Promise<CaptureSessionSummary> {
    return { ...this.summary }
  }

  async close(): Promise<void> {
    this.closeCalls += 1
  }

  emitFrame(
    frame = createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16_000, 10)
  ): void {
    // 主动推一帧，验证控制器的摘要累计和 frame 事件出口是否闭环。
    this.summary.frames += 1
    this.summary.durationMs += frame.durationMs
    this.handlers.onFrame(frame)
  }
}

class FakeCaptureAdapter implements CaptureAdapter {
  public lastRequest?: CaptureOpenRequest
  public session?: FakeCaptureSession

  async open(
    request: CaptureOpenRequest,
    handlers: CaptureHandlers
  ): Promise<CaptureSession> {
    // 用可控假适配器覆盖 open 入参透传、实际声道回填和 warning 回流。
    this.lastRequest = request
    this.session = new FakeCaptureSession(
      handlers,
      request.capture?.sampleRate ?? 48_000,
      request.capture?.channelCount === 2 ? 1 : 1
    )

    if (request.capture?.channelCount === 2) {
      const warningIssue: CaptureIssue = {
        kind: "warning",
        warning: {
          code: RecorderWarningCode.ChannelCountAdjusted,
          message: "Requested 2 channel(s) but the active stream reported 1.",
        },
      }
      handlers.onIssue(warningIssue)
    }

    if (request.capture?.sampleRate === 9_999) {
      const errorIssue: CaptureIssue = {
        kind: "error",
        error: new Error("Synthetic capture failure."),
      }
      handlers.onIssue(errorIssue)
    }

    return this.session
  }
}

class ThrowingCaptureAdapter implements CaptureAdapter {
  constructor(private readonly error: unknown) {}

  async open(): Promise<CaptureSession> {
    throw this.error
  }
}

describe("RecorderController", () => {
  it("runs the phase 1 lifecycle and emits frames, issues, and summaries", async () => {
    const adapter = new FakeCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
      storageOptions: undefined,
    })
    const states: string[] = []
    const frames: number[] = []
    const issues: string[] = []

    recorder.on("statechange", ({ state }) => {
      states.push(state)
    })
    recorder.on("issue", ({ issue, runtimeInfo, summary, controller }) => {
      issues.push(
        issue.kind === "warning" ? issue.warning.code : issue.error.message
      )
      expect(runtimeInfo.requestedChannelCount).toBe(2)
      expect(summary.channels).toBe(2)
      expect(controller).toBe(recorder)
    })
    recorder.on(
      "frame",
      ({ frame, controller, summary, sessionId, emittedAt }) => {
        frames.push(frame.planar[0]?.[1] ?? 0)
        expect(controller).toBe(recorder)
        expect(summary.frames).toBeGreaterThan(0)
        expect(sessionId).toMatch(/^session-/)
        expect(emittedAt).toBeGreaterThan(0)
      }
    )

    const runtime = await recorder.open({
      capture: {
        sampleRate: 16_000,
        channelCount: 2,
      },
    })

    expect(runtime.requestedChannelCount).toBe(2)
    expect(runtime.actualChannelCount).toBe(1)
    expect(adapter.lastRequest?.capture?.sampleRate).toBe(16_000)
    expect(recorder.getState()).toBe(RecorderState.Ready)

    await recorder.start()
    adapter.session?.emitFrame()
    recorder.pause()
    await recorder.resume()
    const summary = await recorder.stop()
    await recorder.close()

    expect(states).toEqual([
      RecorderState.Ready,
      RecorderState.Recording,
      RecorderState.Paused,
      RecorderState.Recording,
      RecorderState.Stopped,
      RecorderState.Closed,
    ])
    expect(issues).toEqual([RecorderWarningCode.ChannelCountAdjusted])
    expect(frames).toEqual([16384])
    expect(summary.frames).toBe(1)
    expect(summary.sampleRate).toBe(16_000)
    expect(summary.channels).toBe(1)
    expect(recorder.getLatestSummary().durationMs).toBeGreaterThan(0)
  })

  it("rejects invalid lifecycle transitions", async () => {
    // 非法状态迁移必须在控制器层被拒绝，而不是把错误下沉到适配器层。
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: undefined,
    })

    await expect(recorder.start()).rejects.toThrow(
      'Recorder state "idle" does not allow this operation.'
    )

    await recorder.open()

    expect(() => recorder.pause()).toThrow(
      'Recorder state "ready" does not allow this operation.'
    )
  })

  it("routes capture issues of kind error into the issue event", async () => {
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: undefined,
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "error") {
        issues.push(issue.error.message)
      }
    })

    await recorder.open({
      capture: {
        sampleRate: 9_999,
      },
    })

    expect(issues).toEqual(["Synthetic capture failure."])
  })

  it("supports explicit off for event listeners", async () => {
    // 显式 off 是事件总线可控性的基础，否则宿主难以安全解绑监听。
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: undefined,
    })
    const receivedStates: RecorderState[] = []
    const listener = ({ state }: { state: RecorderState }): void => {
      receivedStates.push(state)
    }

    recorder.on("statechange", listener)
    recorder.off("statechange", listener)

    await recorder.open()

    expect(receivedStates).toEqual([])
  })

  it("resets internal phase 2 frame buffering when a session is reopened", async () => {
    const adapter = new FakeCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
      storageOptions: undefined,
    })

    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame()
    await recorder.stop()
    await recorder.close()

    await recorder.open()

    expect(recorder.getLatestSummary().frames).toBe(0)
    expect(recorder.getLatestSummary().durationMs).toBe(0)
  })

  it("exports buffered PCM and WAV data from the controller", async () => {
    const adapter = new FakeCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
      storageOptions: undefined,
    })

    await recorder.open({
      capture: {
        sampleRate: 16_000,
      },
    })
    await recorder.start()
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5, 0.25])], 16_000, 10)
    )

    const pcm = await recorder.exportPCM()
    const wav = await recorder.exportWAV({
      bitRate: 8,
    })

    expect(Array.from(pcm.data)).toEqual([0, 16384, -16384, 8192])
    expect(wav.mimeType).toBe("audio/wav")
    expect(wav.bitRate).toBe(8)
    expect(wav.arrayBuffer.byteLength).toBe(48)
  })

  it("rejects exporting when no buffered PCM data exists", async () => {
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: undefined,
    })

    await expect(recorder.exportPCM()).rejects.toThrow(
      "Recorder has no PCM data to export."
    )
    await expect(recorder.exportWAV()).rejects.toThrow(
      "Recorder has no PCM data to export."
    )
  })

  it("emits a warning when persistent mode opens without any persistence plugin", async () => {
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: {
        mode: "persistent",
      },
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "warning") {
        issues.push(issue.warning.code)
      }
    })

    await expect(recorder.open()).rejects.toThrow(
      "Persistent storage mode requires an available persistence plugin before recording starts."
    )

    expect(issues).toEqual([RecorderWarningCode.PersistencePluginMissing])
  })

  it("emits activation warning when persistent storage session creation fails during open", async () => {
    const failingPlugin: RecorderPersistencePlugin = {
      backend: "indexeddb",
      isSupported: () => true,
      createSession: async () => {
        throw new Error("persistent activation failed")
      },
    }
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: {
        mode: "persistent",
        persistencePlugin: failingPlugin,
      },
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "warning") {
        issues.push(issue.warning.code)
      }
    })

    await expect(recorder.open()).rejects.toThrow(
      "persistent activation failed"
    )

    expect(issues).toEqual([RecorderWarningCode.PersistenceActivationFailed])
  })

  it("falls back to memory export when auto-mode persistence activation fails mid-recording", async () => {
    const failingPlugin: RecorderPersistencePlugin = {
      backend: "indexeddb",
      isSupported: () => true,
      createSession: async () => {
        throw new Error("auto promotion failed")
      },
    }
    const adapter = new FakeCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
      storageOptions: {
        mode: "auto",
        memoryThresholdBytes: 1,
        persistencePlugin: failingPlugin,
      },
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "warning") {
        issues.push(issue.warning.code)
      }
    })

    await recorder.open({
      capture: {
        sampleRate: 16_000,
      },
    })
    await recorder.start()
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5, 0.25])], 16_000, 10)
    )

    const pcm = await recorder.exportPCM()

    expect(Array.from(pcm.data)).toEqual([0, 16384, -16384, 8192])
    expect(issues).toContain(RecorderWarningCode.PersistenceActivationFailed)
  })

  it("wraps non-Error open failures into both the issue event and thrown rejection", async () => {
    const recorder = new RecorderController({
      captureAdapter: new ThrowingCaptureAdapter("open failed"),
      storageOptions: undefined,
    })
    const issues: string[] = []

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "error") {
        issues.push(issue.error.message)
      }
    })

    await expect(recorder.open()).rejects.toThrow("Failed to open recorder.")
    expect(issues).toEqual(["Failed to open recorder."])
    expect(recorder.getState()).toBe(RecorderState.Idle)
  })

  it("reports external-stream runtime info when opened with a source stream", async () => {
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: undefined,
    })

    const runtime = await recorder.open({
      sourceStream: {} as MediaStream,
      capture: {
        sampleRate: 16_000,
      },
    })

    expect(runtime.source).toBe("external-stream")
    expect(recorder.getRuntimeInfo().source).toBe("external-stream")
  })

  it("destroys the active session, emits destroyed once, and clears listeners afterwards", async () => {
    const adapter = new FakeCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
      storageOptions: undefined,
    })
    const states: RecorderState[] = []
    const listener = ({ state }: { state: RecorderState }): void => {
      states.push(state)
    }

    recorder.on("statechange", listener)
    await recorder.open()
    await recorder.start()
    await recorder.destroy()

    expect(adapter.session?.closeCalls).toBe(1)
    expect(recorder.getState()).toBe(RecorderState.Destroyed)
    expect(states).toEqual([
      RecorderState.Ready,
      RecorderState.Recording,
      RecorderState.Destroyed,
    ])

    recorder.off("statechange", listener)
    await expect(recorder.open()).rejects.toThrow(
      'Recorder state "destroyed" does not allow this operation.'
    )
    expect(states).toEqual([
      RecorderState.Ready,
      RecorderState.Recording,
      RecorderState.Destroyed,
    ])
  })

  it("returns stable snapshots from runtime and summary accessors", async () => {
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: undefined,
    })

    await recorder.open({
      capture: {
        sampleRate: 16_000,
      },
    })

    const runtime = recorder.getRuntimeInfo()
    const summary = recorder.getLatestSummary()
    runtime.requestedChannelCount = 2
    summary.frames = 999

    expect(recorder.getRuntimeInfo().requestedChannelCount).toBe(1)
    expect(recorder.getLatestSummary().frames).toBe(0)
  })

  it("runs plugin hooks across the recorder lifecycle", async () => {
    const adapter = new FakeCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
      storageOptions: undefined,
    })
    const calls: string[] = []
    const plugin: RecorderPlugin = {
      name: "test-plugin",
      setup() {
        calls.push("setup")
      },
      onStart() {
        calls.push("start")
      },
      onFrame() {
        calls.push("frame")
      },
      onPause() {
        calls.push("pause")
      },
      onResume() {
        calls.push("resume")
      },
      onStop() {
        calls.push("stop")
      },
      dispose() {
        calls.push("dispose")
      },
    }

    await recorder.use(plugin)
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame()
    recorder.pause()
    await recorder.resume()
    await recorder.stop()
    await recorder.destroy()

    expect(calls).toEqual([
      "setup",
      "start",
      "frame",
      "pause",
      "resume",
      "stop",
      "dispose",
    ])
  })

  it("requires plugin events to be registered before emit", async () => {
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: undefined,
    })
    const plugin: RecorderPlugin = {
      name: "unregistered-event-plugin",
      setup(context) {
        context.eventBus.emit("custom-event", {
          value: 1,
        })
      },
    }

    await expect(recorder.use(plugin)).rejects.toThrow(
      'Recorder plugin "unregistered-event-plugin" failed during setup.'
    )
  })

  it("rejects duplicate plugin registration", async () => {
    const recorder = new RecorderController({
      captureAdapter: new FakeCaptureAdapter(),
      storageOptions: undefined,
    })
    const plugin: RecorderPlugin = {
      name: "duplicate-plugin",
      setup() {
        return
      },
    }

    await recorder.use(plugin)

    await expect(recorder.use(plugin)).rejects.toThrow(
      'Recorder plugin "duplicate-plugin" is already registered.'
    )
  })
})
