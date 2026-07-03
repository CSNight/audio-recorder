import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  BrowserInputAdapter,
  listMicrophoneDevices,
} from "../../src/input/browser-input-adapter"
import { RecorderWarningCode } from "../../src"

const selectInputBackendMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/input/backends/select", () => ({
  selectInputBackend: selectInputBackendMock,
}))

type FakeTrack = {
  stop: ReturnType<typeof vi.fn>
  getSettings?: () => MediaTrackSettings
}

type FakeStream = {
  getAudioTracks: () => FakeTrack[]
  getTracks: () => FakeTrack[]
}

type AudioContextStub = AudioContext & {
  constructorArgs?: AudioContextOptions
}

function createStream(
  trackCount = 1,
  settings?: MediaTrackSettings
): FakeStream {
  const tracks = Array.from({ length: trackCount }, () => ({
    stop: vi.fn(),
    ...(settings && { getSettings: () => settings }),
  }))

  return {
    getAudioTracks: () => tracks,
    getTracks: () => tracks,
  }
}

function createAudioContextStub(
  options?: AudioContextOptions
): AudioContextStub {
  return {
    constructorArgs: options,
    sampleRate: options?.sampleRate ?? 48_000,
    state: "running",
    destination: {} as AudioDestinationNode,
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } as unknown as AudioContextStub
}

function fakeBackend(strategy = "media-recorder") {
  return { strategy, suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn() }
}

describe("BrowserInputAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    selectInputBackendMock.mockReset()
    selectInputBackendMock.mockResolvedValue(fakeBackend())
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    })
  })

  it("opens an external stream, forwards the requested sample rate, and selects a backend", async () => {
    const audioContextInstances: AudioContextStub[] = []
    const AudioContextConstructor = vi.fn(function (
      this: unknown,
      options?: AudioContextOptions
    ) {
      const audioContext = createAudioContextStub(options)
      audioContextInstances.push(audioContext)
      return audioContext
    })
    vi.stubGlobal("AudioContext", AudioContextConstructor)

    const stream = createStream()
    const handlers = { onFrame: vi.fn(), onIssue: vi.fn() }
    const adapter = new BrowserInputAdapter()
    const session = await adapter.open(
      {
        sourceStream: stream as unknown as MediaStream,
        input: { sampleRate: 16_000, channelCount: 2 },
      },
      handlers
    )

    expect(AudioContextConstructor).toHaveBeenCalledWith({ sampleRate: 16_000 })
    expect(selectInputBackendMock).toHaveBeenCalledWith({
      requested: "auto",
      context: expect.objectContaining({
        audioContext: audioContextInstances[0],
        channelCount: 2,
        sink: session,
      }),
    })
    expect(session.actualSampleRate).toBe(16_000)
    expect(session.actualInputStrategy).toBe("media-recorder")
  })

  it("passes inputStrategy through to selectInputBackend", async () => {
    const getUserMedia = vi.fn(
      async () => createStream() as unknown as MediaStream
    )
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      mediaDevices: { getUserMedia },
    })
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )

    const adapter = new BrowserInputAdapter()
    await adapter.open(
      { input: { inputStrategy: "audio-worklet" } },
      { onFrame: vi.fn(), onIssue: vi.fn() }
    )

    expect(selectInputBackendMock).toHaveBeenCalledWith(
      expect.objectContaining({ requested: "audio-worklet" })
    )
  })

  it("requests microphone input with exact channelCount and default processing flags", async () => {
    const getUserMedia = vi.fn(
      async () => createStream() as unknown as MediaStream
    )
    vi.stubGlobal("AudioContext", undefined)
    vi.stubGlobal(
      "webkitAudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      mediaDevices: { getUserMedia },
    })

    const adapter = new BrowserInputAdapter()
    await adapter.open(
      {
        input: {
          channelCount: 2,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      },
      { onFrame: vi.fn(), onIssue: vi.fn() }
    )

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: { exact: 2 },
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      },
      video: false,
    })
  })

  it("applies default echoCancellation/noiseSuppression/autoGainControl when not specified", async () => {
    const getUserMedia = vi.fn(
      async () => createStream() as unknown as MediaStream
    )
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      mediaDevices: { getUserMedia },
    })
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )

    const adapter = new BrowserInputAdapter()
    await adapter.open({ input: {} }, { onFrame: vi.fn(), onIssue: vi.fn() })

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })
  })

  it("throws and aborts on OverconstrainedError for an exact channelCount", async () => {
    const overconstrained = Object.assign(new Error("over"), {
      name: "OverconstrainedError",
    })
    const getUserMedia = vi.fn().mockRejectedValueOnce(overconstrained)
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      mediaDevices: { getUserMedia },
    })
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )

    const onIssue = vi.fn()
    const adapter = new BrowserInputAdapter()

    // 用户显式要求的声道数拿不到属于硬失败：抛错中止，不悄悄回退
    await expect(
      adapter.open(
        { input: { channelCount: 2 } },
        { onFrame: vi.fn(), onIssue }
      )
    ).rejects.toThrow(/does not support the requested channelCount 2/)

    // 只尝试一次 exact 约束，不再发起非 exact 重试
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[0]?.[0]).toEqual({
      audio: expect.objectContaining({ channelCount: { exact: 2 } }),
      video: false,
    })
  })

  it("warns when the browser does not apply a requested audio constraint", async () => {
    const getUserMedia = vi.fn(
      async () =>
        createStream(1, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          channelCount: 1,
        } as MediaTrackSettings) as unknown as MediaStream
    )
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      mediaDevices: { getUserMedia },
    })
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )

    const onIssue = vi.fn()
    const adapter = new BrowserInputAdapter()
    await adapter.open(
      { input: { channelCount: 2, autoGainControl: true } },
      { onFrame: vi.fn(), onIssue }
    )

    expect(onIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.AudioConstraintNotApplied,
        message: expect.stringContaining("autoGainControl"),
      },
    })
    expect(onIssue.mock.calls[0]?.[0]?.warning.message).toContain(
      "channelCount"
    )
  })

  it("does not run the constraint diagnostic for external source streams", async () => {
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )

    const onIssue = vi.fn()
    const adapter = new BrowserInputAdapter()
    await adapter.open(
      {
        sourceStream: createStream(1, {
          autoGainControl: false,
        } as MediaTrackSettings) as unknown as MediaStream,
        input: { autoGainControl: true },
      },
      { onFrame: vi.fn(), onIssue }
    )

    expect(onIssue).not.toHaveBeenCalled()
  })

  it("rejects source streams without audio tracks", async () => {
    const AudioContextConstructor = vi.fn(function (
      this: unknown,
      options?: AudioContextOptions
    ) {
      return createAudioContextStub(options)
    })
    vi.stubGlobal("AudioContext", AudioContextConstructor)
    const adapter = new BrowserInputAdapter()

    await expect(
      adapter.open(
        { sourceStream: createStream(0) as unknown as MediaStream },
        { onFrame: vi.fn(), onIssue: vi.fn() }
      )
    ).rejects.toThrow(
      "The provided MediaStream does not contain any audio tracks."
    )
    expect(AudioContextConstructor).not.toHaveBeenCalled()
  })

  it("rejects microphone opening when getUserMedia is unavailable", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0" })
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )
    const adapter = new BrowserInputAdapter()

    await expect(
      adapter.open({}, { onFrame: vi.fn(), onIssue: vi.fn() })
    ).rejects.toThrow("navigator.mediaDevices.getUserMedia is not available.")
  })

  it("passes deviceId as exact constraint to getUserMedia", async () => {
    const getUserMedia = vi.fn(
      async () => createStream() as unknown as MediaStream
    )
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      mediaDevices: { getUserMedia },
    })
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )

    const adapter = new BrowserInputAdapter()
    await adapter.open(
      { input: { deviceId: "mic-device-001" } },
      { onFrame: vi.fn(), onIssue: vi.fn() }
    )

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        deviceId: { exact: "mic-device-001" },
      },
      video: false,
    })
  })
})

describe("listMicrophoneDevices", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("returns only audioinput devices from enumerateDevices", async () => {
    const fakeDevices: Partial<MediaDeviceInfo>[] = [
      {
        kind: "audioinput",
        deviceId: "mic-1",
        label: "Built-in Microphone",
        groupId: "g1",
      },
      {
        kind: "videoinput",
        deviceId: "cam-1",
        label: "Built-in Camera",
        groupId: "g2",
      },
      {
        kind: "audiooutput",
        deviceId: "spk-1",
        label: "Built-in Speaker",
        groupId: "g1",
      },
      {
        kind: "audioinput",
        deviceId: "mic-2",
        label: "External Mic",
        groupId: "g3",
      },
    ]
    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices: vi.fn(async () => fakeDevices) },
    })

    const result = await listMicrophoneDevices()
    expect(result).toHaveLength(2)
    expect(result[0]?.deviceId).toBe("mic-1")
    expect(result[1]?.deviceId).toBe("mic-2")
  })

  it("throws when enumerateDevices is not available", async () => {
    vi.stubGlobal("navigator", { mediaDevices: {} })
    await expect(listMicrophoneDevices()).rejects.toThrow(
      "navigator.mediaDevices.enumerateDevices is not available in the current environment."
    )
  })

  it("throws when navigator.mediaDevices is not available", async () => {
    vi.stubGlobal("navigator", {})
    await expect(listMicrophoneDevices()).rejects.toThrow(
      "navigator.mediaDevices.enumerateDevices is not available in the current environment."
    )
  })
})
