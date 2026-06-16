import { beforeEach, describe, expect, it, vi } from "vitest"

const createCaptureGraphMock = vi.hoisted(() => vi.fn())

vi.mock("@/capture/capture-graph", () => ({
  createCaptureGraph: createCaptureGraphMock,
}))

import { BrowserCaptureAdapter, listMicrophoneDevices } from "@/capture/browser-capture-adapter"

type FakeTrack = {
  stop: ReturnType<typeof vi.fn>
}

type FakeStream = {
  getAudioTracks: () => FakeTrack[]
  getTracks: () => FakeTrack[]
}

type AudioContextStub = AudioContext & {
  constructorArgs?: AudioContextOptions
}

function createStream(trackCount = 1): FakeStream {
  const tracks = Array.from({ length: trackCount }, () => ({
    stop: vi.fn(),
  }))

  return {
    getAudioTracks: () => tracks,
    getTracks: () => tracks,
  }
}

function createAudioContextStub(
  options?: AudioContextOptions
): AudioContextStub {
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    mediaStream: createStream(),
  }
  const gainNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: {
      value: 1,
    },
  }

  return {
    constructorArgs: options,
    sampleRate: options?.sampleRate ?? 48_000,
    state: "running",
    destination: {} as AudioDestinationNode,
    createMediaStreamSource: vi.fn((stream: MediaStream) => ({
      ...sourceNode,
      mediaStream: stream,
    })),
    createGain: vi.fn(() => gainNode),
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  } as unknown as AudioContextStub
}

describe("BrowserCaptureAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    createCaptureGraphMock.mockReset()
  })

  it("opens an external stream, forwards the requested sample rate, and binds the session", async () => {
    const audioContextInstances: AudioContextStub[] = []
    const AudioContextConstructor = vi.fn(function (
      this: unknown,
      options?: AudioContextOptions
    ) {
      const audioContext = createAudioContextStub(options)
      audioContextInstances.push(audioContext)
      return audioContext
    })
    const bindSession = vi.fn()
    const captureNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as AudioNode

    vi.stubGlobal("AudioContext", AudioContextConstructor)
    createCaptureGraphMock.mockResolvedValue({
      captureNode,
      deactivateCaptureNode: vi.fn(),
      bindSession,
    })

    const stream = createStream()
    const handlers = {
      onFrame: vi.fn(),
      onIssue: vi.fn(),
    }
    const adapter = new BrowserCaptureAdapter()
    const session = await adapter.open(
      {
        sourceStream: stream as unknown as MediaStream,
        capture: {
          sampleRate: 16_000,
          channelCount: 2,
        },
      },
      handlers
    )

    expect(AudioContextConstructor).toHaveBeenCalledWith({
      sampleRate: 16_000,
    })
    expect(createCaptureGraphMock).toHaveBeenCalledWith(
      audioContextInstances[0],
      2,
      handlers
    )
    expect(session.actualSampleRate).toBe(16_000)
    expect(bindSession).toHaveBeenCalledTimes(1)
    expect(bindSession.mock.calls[0]?.[0]).toBe(session)
  })

  it("requests microphone input with explicit constraints and falls back to webkitAudioContext", async () => {
    const getUserMedia = vi.fn(
      async () => createStream() as unknown as MediaStream
    )
    const webkitAudioContextInstances: AudioContextStub[] = []
    const webkitAudioContext = vi.fn(function (
      this: unknown,
      options?: AudioContextOptions
    ) {
      const audioContext = createAudioContextStub(options)
      webkitAudioContextInstances.push(audioContext)
      return audioContext
    })

    vi.stubGlobal("AudioContext", undefined)
    vi.stubGlobal("webkitAudioContext", webkitAudioContext)
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia,
      },
    })
    createCaptureGraphMock.mockResolvedValue({
      captureNode: {
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as AudioNode,
      deactivateCaptureNode: vi.fn(),
      bindSession: vi.fn(),
    })

    const adapter = new BrowserCaptureAdapter()
    await adapter.open(
      {
        capture: {
          channelCount: 2,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      },
      {
        onFrame: vi.fn(),
        onIssue: vi.fn(),
      }
    )

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 2,
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
      },
      video: false,
    })
    expect(webkitAudioContext).toHaveBeenCalledWith()
    expect(webkitAudioContextInstances[0]?.constructorArgs).toBeUndefined()
  })

  it("rejects source streams without audio tracks", async () => {
    const AudioContextConstructor = vi.fn(function (
      this: unknown,
      options?: AudioContextOptions
    ) {
      return createAudioContextStub(options)
    })

    vi.stubGlobal("AudioContext", AudioContextConstructor)
    const adapter = new BrowserCaptureAdapter()

    await expect(
      adapter.open(
        {
          sourceStream: createStream(0) as unknown as MediaStream,
        },
        {
          onFrame: vi.fn(),
          onIssue: vi.fn(),
        }
      )
    ).rejects.toThrow(
      "The provided MediaStream does not contain any audio tracks."
    )
    expect(AudioContextConstructor).not.toHaveBeenCalled()
  })

  it("rejects microphone opening when getUserMedia is unavailable", async () => {
    vi.stubGlobal("navigator", {})
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )
    const adapter = new BrowserCaptureAdapter()

    await expect(
      adapter.open(
        {},
        {
          onFrame: vi.fn(),
          onIssue: vi.fn(),
        }
      )
    ).rejects.toThrow("navigator.mediaDevices.getUserMedia is not available.")
  })

  it("rejects opening when the environment exposes no AudioContext constructor", async () => {
    vi.stubGlobal("AudioContext", undefined)
    vi.stubGlobal("webkitAudioContext", undefined)
    const adapter = new BrowserCaptureAdapter()

    await expect(
      adapter.open(
        {
          sourceStream: createStream() as unknown as MediaStream,
        },
        {
          onFrame: vi.fn(),
          onIssue: vi.fn(),
        }
      )
    ).rejects.toThrow(
      "AudioContext is not available in the current environment."
    )
  })

  it("passes deviceId as exact constraint to getUserMedia", async () => {
    const getUserMedia = vi.fn(
      async () => createStream() as unknown as MediaStream
    )
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia,
      },
    })
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function (this: unknown, options?: AudioContextOptions) {
        return createAudioContextStub(options)
      })
    )
    createCaptureGraphMock.mockResolvedValue({
      captureNode: { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
      deactivateCaptureNode: vi.fn(),
      bindSession: vi.fn(),
    })

    const adapter = new BrowserCaptureAdapter()
    await adapter.open(
      {
        capture: {
          deviceId: "mic-device-001",
        },
      },
      { onFrame: vi.fn(), onIssue: vi.fn() }
    )

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
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
      { kind: "audioinput", deviceId: "mic-1", label: "Built-in Microphone", groupId: "g1" },
      { kind: "videoinput", deviceId: "cam-1", label: "Built-in Camera", groupId: "g2" },
      { kind: "audiooutput", deviceId: "spk-1", label: "Built-in Speaker", groupId: "g1" },
      { kind: "audioinput", deviceId: "mic-2", label: "External Mic", groupId: "g3" },
    ]

    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => fakeDevices),
      },
    })

    const result = await listMicrophoneDevices()

    expect(result).toHaveLength(2)
    expect(result[0]?.deviceId).toBe("mic-1")
    expect(result[1]?.deviceId).toBe("mic-2")
    // AudioInputDevice 不含 kind，过滤逻辑已保证结果全为 audioinput
    expect(result[0]?.label).toBe("Built-in Microphone")
    expect(result[1]?.label).toBe("External Mic")
  })

  it("returns an empty array when no audioinput devices are present", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: vi.fn(async () => [
          { kind: "videoinput", deviceId: "cam-1", label: "Camera", groupId: "g1" },
        ]),
      },
    })

    const result = await listMicrophoneDevices()

    expect(result).toHaveLength(0)
  })

  it("throws when enumerateDevices is not available", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {},
    })

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
