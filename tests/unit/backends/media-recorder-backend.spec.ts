import { beforeEach, describe, expect, it, vi } from "vitest"
import { createMediaRecorderBackend } from "@/input/backends/media-recorder-backend"
import { InputBackendUnavailableError } from "@/input/backends/types"
import type { InputBackendContext } from "@/input/backends/types"

vi.mock("@/input/webm-pcm-extractor", () => ({
  createWebMExtractScope: vi.fn(() => ({ webmSR: undefined })),
  webmExtract: vi.fn(() => [new Float32Array([0.5])]),
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

describe("createMediaRecorderBackend", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
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
    mr.ondataavailable?.({ data: blob } as BlobEvent)
    await Promise.resolve()
    await Promise.resolve()

    expect(acceptFrame).toHaveBeenCalledTimes(1)
    expect(acceptFrame.mock.calls[0]?.[0]).toEqual([new Float32Array([0.5])])
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
})
