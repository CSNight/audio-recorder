import { describe, expect, it, vi } from "vitest"
import {
  acquireMicStream,
  buildAudioConstraints,
  reportUnappliedConstraints,
} from "../../src/input/audio-constraints"
import type { RecorderIssue } from "../../src"
import { RecorderWarningCode } from "../../src"

function expectWarningIssue(
  issue: RecorderIssue | undefined
): asserts issue is Extract<RecorderIssue, { kind: "warning" }> {
  expect(issue).toBeDefined()
  expect(issue?.kind).toBe("warning")
}

// ---------------------------------------------------------------------------
// buildAudioConstraints
// ---------------------------------------------------------------------------
describe("buildAudioConstraints", () => {
  it("默认开启 AEC/NS/AGC", () => {
    const constraints = buildAudioConstraints({})
    expect(constraints.echoCancellation).toBe(true)
    expect(constraints.noiseSuppression).toBe(true)
    expect(constraints.autoGainControl).toBe(true)
  })

  it("可以显式关闭各处理项", () => {
    const constraints = buildAudioConstraints({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    })
    expect(constraints.echoCancellation).toBe(false)
    expect(constraints.noiseSuppression).toBe(false)
    expect(constraints.autoGainControl).toBe(false)
  })

  it("channelCount 用 exact 强约束", () => {
    const constraints = buildAudioConstraints({ channelCount: 2 })
    expect(constraints.channelCount).toEqual({ exact: 2 })
  })

  it("未传 channelCount 时不写入约束", () => {
    const constraints = buildAudioConstraints({})
    expect(constraints.channelCount).toBeUndefined()
  })

  it("deviceId 用 exact 强约束", () => {
    const constraints = buildAudioConstraints({ deviceId: "device-001" })
    expect(constraints.deviceId).toEqual({ exact: "device-001" })
  })

  it("未传 deviceId 时不写入约束", () => {
    const constraints = buildAudioConstraints({})
    expect(constraints.deviceId).toBeUndefined()
  })

  it("传入 sampleRate 时写入约束", () => {
    const constraints = buildAudioConstraints({ sampleRate: 48000 })
    expect(constraints.sampleRate).toBe(48000)
  })

  it("未传 sampleRate 时不写入约束", () => {
    const constraints = buildAudioConstraints({})
    expect(constraints.sampleRate).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// acquireMicStream
// ---------------------------------------------------------------------------
describe("acquireMicStream", () => {
  it("getUserMedia 不可用时抛出错误", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: undefined,
    } as unknown as Navigator)
    await expect(acquireMicStream({})).rejects.toThrow(
      "navigator.mediaDevices.getUserMedia is not available"
    )
    vi.unstubAllGlobals()
  })

  it("getUserMedia 成功时返回 MediaStream", async () => {
    const mockStream = { id: "stream-1" }
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    })
    const result = await acquireMicStream({ channelCount: 1 })
    expect(result).toBe(mockStream)
    vi.unstubAllGlobals()
  })

  it("OverconstrainedError + channelCount 时抛出包含声道数的错误", async () => {
    const overconstrainedError = { name: "OverconstrainedError" }
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(overconstrainedError),
      },
    })
    await expect(acquireMicStream({ channelCount: 2 })).rejects.toThrow(
      "channelCount 2"
    )
    vi.unstubAllGlobals()
  })

  it("OverconstrainedError 但未指定 channelCount 时原样重抛", async () => {
    const overconstrainedError = { name: "OverconstrainedError" }
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(overconstrainedError),
      },
    })
    await expect(acquireMicStream({})).rejects.toBe(overconstrainedError)
    vi.unstubAllGlobals()
  })

  it("非 OverconstrainedError 时原样重抛", async () => {
    const genericError = new Error("Permission denied")
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(genericError),
      },
    })
    await expect(acquireMicStream({})).rejects.toBe(genericError)
    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// reportUnappliedConstraints
// ---------------------------------------------------------------------------
describe("reportUnappliedConstraints", () => {
  function makeStream(settings: Record<string, unknown>): MediaStream {
    return {
      getAudioTracks: () => [
        {
          getSettings: () => settings,
        },
      ],
    } as unknown as MediaStream
  }

  it("约束全部生效时不调用 emitIssue", () => {
    const emitIssue = vi.fn<(issue: RecorderIssue) => void>()
    const stream = makeStream({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    })
    reportUnappliedConstraints(stream, { channelCount: 1 }, emitIssue)
    expect(emitIssue).not.toHaveBeenCalled()
  })

  it("echoCancellation 未生效时发出告警", () => {
    const emitIssue = vi.fn<(issue: RecorderIssue) => void>()
    const stream = makeStream({ echoCancellation: false })
    reportUnappliedConstraints(stream, { echoCancellation: true }, emitIssue)
    expect(emitIssue).toHaveBeenCalledOnce()
    const issue = emitIssue.mock.calls[0]?.[0]
    expectWarningIssue(issue)
    expect(issue.warning.code).toBe(
      RecorderWarningCode.AudioConstraintNotApplied
    )
    expect(issue.warning.message).toContain("echoCancellation")
  })

  it("channelCount 不匹配时发出告警", () => {
    const emitIssue = vi.fn<(issue: RecorderIssue) => void>()
    const stream = makeStream({ channelCount: 1 })
    reportUnappliedConstraints(stream, { channelCount: 2 }, emitIssue)
    expect(emitIssue).toHaveBeenCalledOnce()
    const issue = emitIssue.mock.calls[0]?.[0]
    expectWarningIssue(issue)
    expect(issue.warning.message).toContain("channelCount")
  })

  it("无音频 track 时静默返回", () => {
    const emitIssue = vi.fn<(issue: RecorderIssue) => void>()
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream
    reportUnappliedConstraints(stream, {}, emitIssue)
    expect(emitIssue).not.toHaveBeenCalled()
  })

  it("settings 中缺失的字段不误报", () => {
    const emitIssue = vi.fn<(issue: RecorderIssue) => void>()
    // settings 完全为空，浏览器不上报任何值
    const stream = makeStream({})
    reportUnappliedConstraints(
      stream,
      { echoCancellation: true, channelCount: 2 },
      emitIssue
    )
    expect(emitIssue).not.toHaveBeenCalled()
  })
})
