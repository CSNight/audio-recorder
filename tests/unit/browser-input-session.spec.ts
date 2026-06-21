import { describe, expect, it, vi } from "vitest"
import { BrowserInputSession } from "@/input/browser-input-session"
import type { InputBackend } from "@/input/backends/types"
import type { AudioChannelCount } from "@/types"
import { RecorderWarningCode } from "@/types"

type FakeTrack = { stop: ReturnType<typeof vi.fn> }

function createAudioContextStub(sampleRate = 48_000): AudioContext {
  return {
    sampleRate,
    state: "running",
    destination: {} as AudioDestinationNode,
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } as unknown as AudioContext
}

function createFakeBackend(
  strategy: InputBackend["strategy"] = "media-recorder"
): InputBackend {
  return {
    strategy,
    suspend: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn(),
  }
}

function createSession(options: {
  audioContext?: AudioContext
  stream?: MediaStream
  onFrame?: ReturnType<typeof vi.fn>
  onIssue?: ReturnType<typeof vi.fn>
  requestedChannelCount?: AudioChannelCount
  ownsStream?: boolean
  disableEnvInFix?: boolean
  backend?: InputBackend
}) {
  const onFrame = options.onFrame ?? vi.fn()
  const onIssue = options.onIssue ?? vi.fn()
  const backend = options.backend ?? createFakeBackend()
  const session = new BrowserInputSession({
    audioContext: options.audioContext ?? createAudioContextStub(16_000),
    stream:
      options.stream ?? ({ getTracks: () => [] } as unknown as MediaStream),
    handlers: { onFrame, onIssue },
    requestedChannelCount: options.requestedChannelCount ?? 1,
    ownsStream: options.ownsStream ?? false,
    disableEnvInFix: options.disableEnvInFix ?? false,
  })
  session.attachBackend(backend)
  return { session, onFrame, onIssue, backend }
}

describe("BrowserInputSession", () => {
  it("exposes the attached backend strategy and drives suspend/resume", async () => {
    const backend = createFakeBackend("audio-worklet")
    const { session } = createSession({ backend })

    expect(session.actualInputStrategy).toBe("audio-worklet")

    await session.start()
    expect(backend.resume).toHaveBeenCalledTimes(1)
    session.pause()
    expect(backend.suspend).toHaveBeenCalledTimes(1)
    await session.resume()
    expect(backend.resume).toHaveBeenCalledTimes(2)
    await session.stop()
    expect(backend.suspend).toHaveBeenCalledTimes(2)
  })

  it("accepts frames only while recording and emits a single channel adjustment warning", async () => {
    const { session, onFrame, onIssue } = createSession({
      requestedChannelCount: 2,
    })

    session.acceptFrame([new Float32Array([0.5, -0.5])], 1)
    expect(onFrame).not.toHaveBeenCalled()

    await session.start()
    session.acceptFrame([new Float32Array([0.5, -0.5])], 10)
    session.acceptFrame([new Float32Array([0.25, -0.25])], 20)
    const summary = await session.stop()

    expect(onFrame).toHaveBeenCalledTimes(2)
    expect(summary.frames).toBe(2)
    expect(summary.durationMs).toBeGreaterThan(0)
    expect(session.actualChannelCount).toBe(1)
    expect(onIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.ChannelCountAdjusted,
        message: "Requested 2 channel(s) but the active stream reported 1.",
      },
    })
  })

  it("inserts a silent compensation frame when frame loss exceeds threshold", async () => {
    const { session, onFrame, onIssue } = createSession({})
    await session.start()

    const frameData = [new Float32Array(160)]
    let t = 0
    vi.spyOn(performance, "now").mockImplementation(() => t)

    for (let i = 0; i < 6; i++) {
      t += 50
      session.acceptFrame(frameData, t)
    }

    expect(onIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "warning",
        warning: expect.objectContaining({
          code: RecorderWarningCode.FrameLossDetected,
        }),
      })
    )
    expect(onFrame.mock.calls.length).toBeGreaterThan(6)
  })

  it("reports FrameLossDetected warning but skips silent frame when disableEnvInFix is true", async () => {
    const { session, onFrame, onIssue } = createSession({
      disableEnvInFix: true,
    })
    await session.start()

    const frameData = [new Float32Array(160)]
    let t = 0
    vi.spyOn(performance, "now").mockImplementation(() => t)

    for (let i = 0; i < 6; i++) {
      t += 50
      session.acceptFrame(frameData, t)
    }

    expect(onIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "warning",
        warning: expect.objectContaining({
          code: RecorderWarningCode.FrameLossDetected,
        }),
      })
    )
    expect(onFrame).toHaveBeenCalledTimes(6)
  })

  it("resets the frame loss window on resume so paused time is not counted as loss", async () => {
    const { session, onFrame, onIssue } = createSession({})
    await session.start()

    const frameData = [new Float32Array(160)]
    let t = 0
    vi.spyOn(performance, "now").mockImplementation(() => t)

    for (let i = 0; i < 3; i++) {
      t += 10
      session.acceptFrame(frameData, t)
    }

    session.pause()
    t += 5000
    await session.resume()

    for (let i = 0; i < 6; i++) {
      t += 10
      session.acceptFrame(frameData, t)
    }

    const lossWarnings = onIssue.mock.calls.filter(
      (call) =>
        call[0]?.kind === "warning" &&
        call[0]?.warning?.code === RecorderWarningCode.FrameLossDetected
    )
    expect(lossWarnings).toHaveLength(0)
    expect(onFrame).toHaveBeenCalledTimes(9)
  })

  it("truncates the sliding window when frames older than 3 seconds are present", async () => {
    const { session, onFrame, onIssue } = createSession({})
    await session.start()

    const frameData = [new Float32Array(160)]
    let t = 0
    vi.spyOn(performance, "now").mockImplementation(() => t)

    for (let i = 0; i < 3; i++) {
      t += 10
      session.acceptFrame(frameData, t)
    }

    t += 4000
    session.acceptFrame(frameData, t)

    const lossWarnings = onIssue.mock.calls.filter(
      (call) =>
        call[0]?.kind === "warning" &&
        call[0]?.warning?.code === RecorderWarningCode.FrameLossDetected
    )
    expect(lossWarnings).toHaveLength(0)
    expect(onFrame).toHaveBeenCalledTimes(4)
  })

  it("disposes backend, closes owned tracks and prevents invalid lifecycle transitions", async () => {
    const track: FakeTrack = { stop: vi.fn() }
    const stream = { getTracks: () => [track] } as unknown as MediaStream
    const audioContext = createAudioContextStub()
    const backend = createFakeBackend()
    const { session } = createSession({
      audioContext,
      stream,
      ownsStream: true,
      backend,
    })

    expect(() => session.pause()).toThrow(
      `Input session state "ready" does not allow this operation.`
    )

    await session.start()
    await session.close()
    await session.close()

    expect(backend.dispose).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(audioContext.close).toHaveBeenCalledTimes(1)
  })
})
