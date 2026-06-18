import { describe, expect, it, vi } from "vitest"
import { BrowserInputSession } from "@/input/browser-input-session"
import { RecorderWarningCode } from "@/types"

type FakeTrack = {
  stop: ReturnType<typeof vi.fn>
}

type FakeStream = {
  getTracks: () => FakeTrack[]
}

function createAudioContextStub(sampleRate = 48_000): AudioContext {
  const mediaStream = {
    getTracks: vi.fn(() => []),
  }
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    mediaStream,
  }
  const gainNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      value: 1,
    },
  }

  return {
    sampleRate,
    state: "running",
    destination: {} as AudioDestinationNode,
    createMediaStreamSource: vi.fn(() => sourceNode),
    createGain: vi.fn(() => gainNode),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } as unknown as AudioContext
}

describe("BrowserInputSession", () => {
  it("accepts frames only while recording and emits a single channel adjustment warning", async () => {
    const onFrame = vi.fn()
    const onIssue = vi.fn()
    const audioContext = createAudioContextStub(16_000)
    const session = new BrowserInputSession({
      audioContext,
      stream: { getTracks: () => [] } as unknown as MediaStream,
      handlers: {
        onFrame,
        onIssue,
      },
      requestedChannelCount: 2,
      ownsStream: false,
      inputNode: {
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as AudioNode,
      deactivateInputNode: vi.fn(),
      disableEnvInFix: false,
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
    const onFrame = vi.fn()
    const onIssue = vi.fn()
    const audioContext = createAudioContextStub(16_000)
    const session = new BrowserInputSession({
      audioContext,
      stream: { getTracks: () => [] } as unknown as MediaStream,
      handlers: { onFrame, onIssue },
      requestedChannelCount: 1,
      ownsStream: false,
      inputNode: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
      deactivateInputNode: vi.fn(),
      disableEnvInFix: false,
    })

    await session.start()

    // Feed 6+ frames with artificially large timestamps to trigger the dual-threshold.
    // Each frame: 160 samples @ 16kHz = 10ms PCM time.
    // Timestamps advance by 50ms per frame → 40ms gap each → lost accumulates fast.
    const frameData = [new Float32Array(160)]
    let t = 0
    vi.spyOn(performance, "now").mockImplementation(() => t)

    // Prime the window with 6 frames so length >= 6 guard passes
    for (let i = 0; i < 6; i++) {
      t += 50 // 50ms wall clock per frame, 10ms PCM → 40ms lost per frame
      session.acceptFrame(frameData, t)
    }

    // After 6 frames: tsIn ≈ 300ms, tsPcm = 60ms → lost = 240ms > 300/3 = 100ms ✓
    // addTime ≈ 50 - 10 = 40ms > 10/5 = 2ms ✓  → compensation should fire
    const frameCalls = onFrame.mock.calls.length
    expect(onIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "warning",
        warning: expect.objectContaining({
          code: RecorderWarningCode.FrameLossDetected,
        }),
      })
    )
    // Silent frame + real frame both emitted → more frames than inputs
    expect(frameCalls).toBeGreaterThan(6)
  })

  it("reports FrameLossDetected warning but skips silent frame when disableEnvInFix is true", async () => {
    const onFrame = vi.fn()
    const onIssue = vi.fn()
    const audioContext = createAudioContextStub(16_000)
    const session = new BrowserInputSession({
      audioContext,
      stream: { getTracks: () => [] } as unknown as MediaStream,
      handlers: { onFrame, onIssue },
      requestedChannelCount: 1,
      ownsStream: false,
      inputNode: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
      deactivateInputNode: vi.fn(),
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
    // No silent frame inserted → exactly 6 onFrame calls
    expect(onFrame).toHaveBeenCalledTimes(6)
  })

  it("resets the frame loss window on resume so paused time is not counted as loss", async () => {
    const onFrame = vi.fn()
    const onIssue = vi.fn()
    const audioContext = createAudioContextStub(16_000)
    const session = new BrowserInputSession({
      audioContext,
      stream: { getTracks: () => [] } as unknown as MediaStream,
      handlers: { onFrame, onIssue },
      requestedChannelCount: 1,
      ownsStream: false,
      inputNode: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
      deactivateInputNode: vi.fn(),
      disableEnvInFix: false,
    })

    await session.start()

    const frameData = [new Float32Array(160)]
    let t = 0
    vi.spyOn(performance, "now").mockImplementation(() => t)

    // Record 3 frames normally (no loss)
    for (let i = 0; i < 3; i++) {
      t += 10
      session.acceptFrame(frameData, t)
    }

    // Pause then jump time forward by 5 seconds (simulating pause)
    session.pause()
    t += 5000

    // Resume resets the window
    await session.resume()

    // Record 6 more frames at normal 10ms cadence
    for (let i = 0; i < 6; i++) {
      t += 10
      session.acceptFrame(frameData, t)
    }

    // No frame loss warnings expected — paused gap was cleared on resume
    const lossWarnings = onIssue.mock.calls.filter(
      (call) =>
        call[0]?.kind === "warning" &&
        call[0]?.warning?.code === RecorderWarningCode.FrameLossDetected
    )
    expect(lossWarnings).toHaveLength(0)
    expect(onFrame).toHaveBeenCalledTimes(9)
  })

  it("closes owned tracks and prevents invalid lifecycle transitions", async () => {
    const track: FakeTrack = {
      stop: vi.fn(),
    }
    const stream: FakeStream = {
      getTracks: () => [track],
    }
    const deactivateInputNode = vi.fn()
    const audioContext = createAudioContextStub()
    const createMediaStreamSource =
      audioContext.createMediaStreamSource as ReturnType<typeof vi.fn>
    createMediaStreamSource.mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
      mediaStream: stream,
    })
    const session = new BrowserInputSession({
      audioContext,
      stream: stream as unknown as MediaStream,
      handlers: {
        onFrame: vi.fn(),
        onIssue: vi.fn(),
      },
      requestedChannelCount: 1,
      ownsStream: true,
      inputNode: {
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as AudioNode,
      deactivateInputNode,
      disableEnvInFix: false,
    })

    expect(() => session.pause()).toThrow(
      `Input session state "ready" does not allow this operation.`
    )

    await session.start()
    await session.close()
    await session.close()

    expect(deactivateInputNode).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(audioContext.close).toHaveBeenCalledTimes(1)
  })
})
