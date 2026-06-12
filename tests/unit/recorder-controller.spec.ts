import { describe, expect, it } from "vitest"
import type {
  CaptureAdapter,
  CaptureHandlers,
  CaptureOpenRequest,
  CaptureSession,
  CaptureSessionSummary,
} from "../../src/capture/types"
import { RecorderController } from "../../src/core/recorder-controller"
import { RecorderState, RecorderWarningCode } from "../../src/types"
import { createAudioFrame } from "../../src/utils/audio-frame"

class FakeCaptureSession implements CaptureSession {
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
    this.lastRequest = request
    this.session = new FakeCaptureSession(
      handlers,
      request.capture?.sampleRate ?? 48_000,
      request.capture?.channelCount === 2 ? 1 : 1
    )

    if (request.capture?.channelCount === 2) {
      handlers.onWarning({
        code: RecorderWarningCode.ChannelCountAdjusted,
        message: "Requested 2 channel(s) but the active stream reported 1.",
      })
    }

    return this.session
  }
}

describe("RecorderController", () => {
  it("runs the phase 1 lifecycle and emits frames, warnings, and summaries", async () => {
    const adapter = new FakeCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
    })
    const states: string[] = []
    const warnings: string[] = []
    const frames: number[] = []

    recorder.on("statechange", ({ state }) => {
      states.push(state)
    })
    recorder.on("warning", ({ warning, runtimeInfo, summary, controller }) => {
      warnings.push(warning.code)
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
    expect(warnings).toEqual([RecorderWarningCode.ChannelCountAdjusted])
    expect(frames).toEqual([16384])
    expect(summary.frames).toBe(1)
    expect(summary.sampleRate).toBe(16_000)
    expect(summary.channels).toBe(1)
    expect(recorder.getLatestSummary().durationMs).toBeGreaterThan(0)
  })

  it("rejects invalid lifecycle transitions", async () => {
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

  it("supports explicit off for event listeners", async () => {
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
