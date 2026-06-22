import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMediaRecorderBackend } from "@/input/backends/media-recorder-backend"
import { InputBackendUnavailableError } from "@/input/backends/types"
import type { InputBackendContext } from "@/input/backends/types"
import { RecorderWarningCode } from "@/types"

const createWebMExtractScopeMock = vi.hoisted(() => vi.fn())
const webmExtractMock = vi.hoisted(() => vi.fn())

vi.mock("@/input/webm-pcm-extractor", () => ({
  createWebMExtractScope: createWebMExtractScopeMock,
  webmExtract: webmExtractMock,
}))

function createContext(
  overrides: Partial<InputBackendContext> = {}
): InputBackendContext {
  return {
    audioContext: { sampleRate: 48_000 } as AudioContext,
    stream: {} as MediaStream,
    channelCount: 1,
    sink: { acceptFrame: vi.fn() },
    emitIssue: vi.fn(),
    ...overrides,
  }
}

function buildFakeMediaRecorder(
  opts: { autoStart?: boolean; throwOnStart?: boolean } = {}
) {
  const mr = {
    ondataavailable: null as ((e: BlobEvent) => void) | null,
    onerror: null as (() => void) | null,
    onstart: null as (() => void) | null,
    start(_timeslice?: number) {
      if (opts.throwOnStart) throw new Error("start failed")
      if (opts.autoStart !== false) {
        setTimeout(() => mr.onstart?.(), 0)
      }
    },
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  }
  return mr
}

function emitDataAvailable(
  handler: ((event: BlobEvent) => void) | null,
  data: Blob | undefined
): void {
  handler?.({ data } as unknown as BlobEvent)
}

describe("createMediaRecorderBackend", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    createWebMExtractScopeMock.mockReset()
    webmExtractMock.mockReset()
    createWebMExtractScopeMock.mockImplementation(() => ({ webmSR: undefined }))
    webmExtractMock.mockImplementation(() => [new Float32Array([0.5])])
  })

  it("rejects with InputBackendUnavailableError when MIME unsupported", async () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false })
    await expect(
      createMediaRecorderBackend(createContext())
    ).rejects.toBeInstanceOf(InputBackendUnavailableError)
  })

  it("resolves on onstart and does NOT create any Web Audio routing nodes (no round-trip)", async () => {
    const mr = buildFakeMediaRecorder()
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const createMediaStreamDestination = vi.fn()
    const createMediaStreamSource = vi.fn()
    const createGain = vi.fn()
    const audioContext = {
      sampleRate: 48_000,
      createMediaStreamDestination,
      createMediaStreamSource,
      createGain,
    } as unknown as AudioContext

    const stream = {} as MediaStream
    const backend = await createMediaRecorderBackend(
      createContext({ audioContext, stream })
    )

    expect(backend.strategy).toBe("media-recorder")
    // 关键回归断言：直录原始流，绝不建立绕图（source/gain/destination 均不调用）
    expect(Ctor).toHaveBeenCalledWith(stream, {
      mimeType: "audio/webm; codecs=pcm",
    })
    expect(createMediaStreamDestination).not.toHaveBeenCalled()
    expect(createMediaStreamSource).not.toHaveBeenCalled()
    expect(createGain).not.toHaveBeenCalled()
  })

  it("forwards extracted frames to the sink", async () => {
    const mr = buildFakeMediaRecorder()
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const acceptFrame = vi.fn()
    await createMediaRecorderBackend(createContext({ sink: { acceptFrame } }))

    const blob = {
      size: 4,
      arrayBuffer: async () => new Uint8Array(4).buffer,
    } as unknown as Blob
    emitDataAvailable(mr.ondataavailable, blob)
    await Promise.resolve()
    await Promise.resolve()

    expect(acceptFrame).toHaveBeenCalledTimes(1)
    expect(acceptFrame.mock.calls[0]?.[0]).toEqual([new Float32Array([0.5])])
  })

  it("warns and drops invalid WebM chunks instead of forwarding garbage to the sink", async () => {
    webmExtractMock.mockReturnValue("invalid")

    const mr = buildFakeMediaRecorder()
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const acceptFrame = vi.fn()
    const emitIssue = vi.fn()
    await createMediaRecorderBackend(
      createContext({ sink: { acceptFrame }, emitIssue })
    )

    const blob = {
      size: 4,
      arrayBuffer: async () => new Uint8Array(4).buffer,
    } as unknown as Blob
    emitDataAvailable(mr.ondataavailable, blob)
    await Promise.resolve()
    await Promise.resolve()

    expect(acceptFrame).not.toHaveBeenCalled()
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.MediaRecorderFallback,
        message:
          "MediaRecorder produced unrecognised WebM/PCM data; falling back.",
      },
    })
  })

  it("ignores partial extractor results without emitting frames or warnings", async () => {
    webmExtractMock.mockReturnValue(null)

    const mr = buildFakeMediaRecorder()
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const acceptFrame = vi.fn()
    const emitIssue = vi.fn()
    await createMediaRecorderBackend(
      createContext({ sink: { acceptFrame }, emitIssue })
    )

    const blob = {
      size: 4,
      arrayBuffer: async () => new Uint8Array(4).buffer,
    } as unknown as Blob
    emitDataAvailable(mr.ondataavailable, blob)
    await Promise.resolve()
    await Promise.resolve()

    expect(acceptFrame).not.toHaveBeenCalled()
    expect(emitIssue).not.toHaveBeenCalled()
  })

  it("warns only once when MediaRecorder sample rate differs from AudioContext", async () => {
    createWebMExtractScopeMock.mockImplementation(() => ({ webmSR: 44_100 }))

    const mr = buildFakeMediaRecorder()
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const acceptFrame = vi.fn()
    const emitIssue = vi.fn()
    await createMediaRecorderBackend(
      createContext({
        audioContext: { sampleRate: 48_000 } as AudioContext,
        sink: { acceptFrame },
        emitIssue,
      })
    )

    const blob = {
      size: 4,
      arrayBuffer: async () => new Uint8Array(4).buffer,
    } as unknown as Blob

    emitDataAvailable(mr.ondataavailable, blob)
    await Promise.resolve()
    await Promise.resolve()
    emitDataAvailable(mr.ondataavailable, blob)
    await Promise.resolve()
    await Promise.resolve()

    expect(acceptFrame).toHaveBeenCalledTimes(2)
    expect(emitIssue).toHaveBeenCalledTimes(1)
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.MediaRecorderFallback,
        message:
          "MediaRecorder sample rate (44100) differs from AudioContext (48000).",
      },
    })
  })

  it("ignores blob read failures instead of surfacing partial backend errors", async () => {
    const mr = buildFakeMediaRecorder()
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const acceptFrame = vi.fn()
    const emitIssue = vi.fn()
    await createMediaRecorderBackend(
      createContext({ sink: { acceptFrame }, emitIssue })
    )

    const blob = {
      size: 4,
      arrayBuffer: async () => {
        throw new Error("read failed")
      },
    } as unknown as Blob
    emitDataAvailable(mr.ondataavailable, blob)
    await Promise.resolve()
    await Promise.resolve()

    expect(acceptFrame).not.toHaveBeenCalled()
    expect(emitIssue).not.toHaveBeenCalled()
  })

  it("ignores empty dataavailable events without touching the blob reader", async () => {
    const mr = buildFakeMediaRecorder()
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const acceptFrame = vi.fn()
    await createMediaRecorderBackend(createContext({ sink: { acceptFrame } }))

    const emptyBlob = {
      size: 0,
      arrayBuffer: vi.fn(async () => new Uint8Array(0).buffer),
    } as unknown as Blob
    emitDataAvailable(mr.ondataavailable, emptyBlob)
    emitDataAvailable(mr.ondataavailable, undefined)
    await Promise.resolve()

    expect(acceptFrame).not.toHaveBeenCalled()
    expect(
      (emptyBlob as unknown as { arrayBuffer: ReturnType<typeof vi.fn> })
        .arrayBuffer
    ).not.toHaveBeenCalled()
  })

  it("suspend/resume/dispose map to recorder pause/resume/stop", async () => {
    const mr = buildFakeMediaRecorder()
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const backend = await createMediaRecorderBackend(createContext())
    backend.suspend()
    backend.resume()
    backend.dispose()
    expect(mr.pause).toHaveBeenCalledTimes(1)
    expect(mr.resume).toHaveBeenCalledTimes(1)
    expect(mr.stop).toHaveBeenCalledTimes(1)
  })

  it("swallows pause/resume/dispose recorder exceptions after startup", async () => {
    const mr = buildFakeMediaRecorder()
    mr.pause.mockImplementation(() => {
      throw new Error("pause failed")
    })
    mr.resume.mockImplementation(() => {
      throw new Error("resume failed")
    })
    mr.stop.mockImplementation(() => {
      throw new Error("stop failed")
    })
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const backend = await createMediaRecorderBackend(createContext())

    expect(() => backend.suspend()).not.toThrow()
    expect(() => backend.resume()).not.toThrow()
    expect(() => backend.dispose()).not.toThrow()
  })

  it("rejects on 500ms timeout when onstart never fires", async () => {
    vi.useFakeTimers()
    const mr = buildFakeMediaRecorder({ autoStart: false })
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const promise = createMediaRecorderBackend(createContext())
    const assertion = expect(promise).rejects.toBeInstanceOf(
      InputBackendUnavailableError
    )
    await vi.advanceTimersByTimeAsync(600)
    await assertion
    vi.useRealTimers()
  })

  it("rejects and cleans up when MediaRecorder errors before startup completes", async () => {
    const mr = buildFakeMediaRecorder({ autoStart: false })
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    const promise = createMediaRecorderBackend(createContext())
    mr.onerror?.()

    await expect(promise).rejects.toThrow(
      "MediaRecorder emitted an error before becoming available."
    )
    expect(mr.stop).toHaveBeenCalledTimes(1)
    expect(mr.ondataavailable).toBeNull()
    expect(mr.onerror).toBeNull()
    expect(mr.onstart).toBeNull()
  })

  it("rejects when start() throws", async () => {
    const mr = buildFakeMediaRecorder({ throwOnStart: true })
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    await expect(
      createMediaRecorderBackend(createContext())
    ).rejects.toBeInstanceOf(InputBackendUnavailableError)
  })

  it("falls back to a stable start error message when start throws a non-Error value", async () => {
    const mr = {
      ondataavailable: null as ((e: BlobEvent) => void) | null,
      onerror: null as (() => void) | null,
      onstart: null as (() => void) | null,
      start() {
        throw "start failed"
      },
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    }
    const Ctor = vi.fn(function () {
      return mr
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    await expect(createMediaRecorderBackend(createContext())).rejects.toThrow(
      "MediaRecorder.start() failed"
    )
  })

  it("falls back to a stable error message when MediaRecorder construction throws a non-Error value", async () => {
    const Ctor = vi.fn(function () {
      throw "ctor failed"
    })
    ;(Ctor as unknown as { isTypeSupported: () => boolean }).isTypeSupported =
      () => true
    vi.stubGlobal("MediaRecorder", Ctor)

    await expect(createMediaRecorderBackend(createContext())).rejects.toThrow(
      "MediaRecorder construction failed"
    )
  })
})
