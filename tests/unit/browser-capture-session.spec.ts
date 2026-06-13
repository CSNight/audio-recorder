import { describe, expect, it, vi } from "vitest"
import { BrowserCaptureSession } from "@/capture/browser-capture-session"
import { CaptureSessionState, RecorderWarningCode } from "@/types"

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

describe("BrowserCaptureSession", () => {
  it("accepts frames only while recording and emits a single channel adjustment warning", async () => {
    const onFrame = vi.fn()
    const onIssue = vi.fn()
    const audioContext = createAudioContextStub(16_000)
    const session = new BrowserCaptureSession({
      audioContext,
      stream: { getTracks: () => [] } as unknown as MediaStream,
      handlers: {
        onFrame,
        onIssue,
      },
      requestedChannelCount: 2,
      ownsStream: false,
      captureNode: {
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as AudioNode,
      deactivateCaptureNode: vi.fn(),
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
    expect(onIssue).toHaveBeenCalledTimes(1)
    expect(onIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.ChannelCountAdjusted,
        message: "Requested 2 channel(s) but the active stream reported 1.",
      },
    })
  })

  it("closes owned tracks and prevents invalid lifecycle transitions", async () => {
    const track: FakeTrack = {
      stop: vi.fn(),
    }
    const stream: FakeStream = {
      getTracks: () => [track],
    }
    const deactivateCaptureNode = vi.fn()
    const audioContext = createAudioContextStub()
    const createMediaStreamSource =
      audioContext.createMediaStreamSource as ReturnType<typeof vi.fn>
    createMediaStreamSource.mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
      mediaStream: stream,
    })
    const session = new BrowserCaptureSession({
      audioContext,
      stream: stream as unknown as MediaStream,
      handlers: {
        onFrame: vi.fn(),
        onIssue: vi.fn(),
      },
      requestedChannelCount: 1,
      ownsStream: true,
      captureNode: {
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as AudioNode,
      deactivateCaptureNode,
    })

    expect(() => session.pause()).toThrow(
      `Capture session state "${CaptureSessionState.Ready}" does not allow this operation.`
    )

    await session.start()
    await session.close()
    await session.close()

    expect(deactivateCaptureNode).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(audioContext.close).toHaveBeenCalledTimes(1)
  })
})
