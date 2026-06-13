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
import { createAudioFrame } from "@/utils/audio-frame"

class FakeCaptureSession implements CaptureSession {
  // 伪 session 只保留控制器关心的最小行为，用于隔离浏览器音频实现细节。
  private readonly summary: CaptureSessionSummary = {
    frames: 0,
    durationMs: 0,
  }

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

  async close(): Promise<void> {}

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

describe("RecorderController", () => {
  it("runs the phase 1 lifecycle and emits frames, issues, and summaries", async () => {
    const adapter = new FakeCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
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
})
