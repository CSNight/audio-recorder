import { beforeEach, describe, expect, it, vi } from "vitest"
import { selectInputBackend } from "../../../src/input/backends/select"
import type { InputBackendContext } from "../../../src/input/backends/types"
import { InputBackendUnavailableError } from "../../../src/input/backends/types"
import { RecorderWarningCode } from "../../../src"

const mrFactory = vi.hoisted(() => vi.fn())
const workletFactory = vi.hoisted(() => vi.fn())
const spFactory = vi.hoisted(() => vi.fn())

vi.mock("../../../src/input/backends/media-recorder-backend", () => ({
  createMediaRecorderBackend: mrFactory,
}))
vi.mock("../../../src/input/backends/audio-worklet-backend", () => ({
  createAudioWorkletBackend: workletFactory,
}))
vi.mock("../../../src/input/backends/script-processor-backend", () => ({
  createScriptProcessorBackend: spFactory,
}))

function fakeBackend(strategy: string) {
  return { strategy, suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn() }
}

function createContext(emitIssue = vi.fn()): InputBackendContext {
  return {
    audioContext: {} as AudioContext,
    stream: {} as MediaStream,
    channelCount: 1,
    sink: { acceptFrame: vi.fn() },
    emitIssue,
  }
}

describe("selectInputBackend", () => {
  beforeEach(() => {
    mrFactory.mockReset()
    workletFactory.mockReset()
    spFactory.mockReset()
  })

  it("auto: prefers MediaRecorder when available", async () => {
    mrFactory.mockResolvedValue(fakeBackend("media-recorder"))
    const backend = await selectInputBackend({
      requested: "auto",
      context: createContext(),
    })
    expect(backend.strategy).toBe("media-recorder")
    expect(workletFactory).not.toHaveBeenCalled()
    expect(spFactory).not.toHaveBeenCalled()
  })

  it("auto: falls back MR → worklet with a fallback warning", async () => {
    mrFactory.mockRejectedValue(
      new InputBackendUnavailableError("media-recorder", "no pcm")
    )
    workletFactory.mockResolvedValue(fakeBackend("audio-worklet"))
    const emitIssue = vi.fn()

    const backend = await selectInputBackend({
      requested: "auto",
      context: createContext(emitIssue),
    })

    expect(backend.strategy).toBe("audio-worklet")
    expect(emitIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "warning",
        warning: expect.objectContaining({
          code: RecorderWarningCode.MediaRecorderFallback,
        }),
      })
    )
  })

  it("auto: falls back all the way to ScriptProcessor", async () => {
    mrFactory.mockRejectedValue(
      new InputBackendUnavailableError("media-recorder", "x")
    )
    workletFactory.mockRejectedValue(
      new InputBackendUnavailableError("audio-worklet", "y")
    )
    spFactory.mockResolvedValue(fakeBackend("script-processor"))

    const backend = await selectInputBackend({
      requested: "auto",
      context: createContext(),
    })
    expect(backend.strategy).toBe("script-processor")
  })

  it("explicit strategy is tried first", async () => {
    workletFactory.mockResolvedValue(fakeBackend("audio-worklet"))
    const backend = await selectInputBackend({
      requested: "audio-worklet",
      context: createContext(),
    })
    expect(backend.strategy).toBe("audio-worklet")
    // explicit worklet preferred — MediaRecorder not even attempted
    expect(mrFactory).not.toHaveBeenCalled()
  })

  it("explicit script-processor does not try higher-priority backends first", async () => {
    spFactory.mockResolvedValue(fakeBackend("script-processor"))

    const backend = await selectInputBackend({
      requested: "script-processor",
      context: createContext(),
    })

    expect(backend.strategy).toBe("script-processor")
    expect(mrFactory).not.toHaveBeenCalled()
    expect(workletFactory).not.toHaveBeenCalled()
  })

  it("explicit-but-unavailable: warns then auto-degrades down the standard chain", async () => {
    workletFactory.mockRejectedValue(
      new InputBackendUnavailableError("audio-worklet", "no worklet")
    )
    mrFactory.mockResolvedValue(fakeBackend("media-recorder"))
    const emitIssue = vi.fn()

    const backend = await selectInputBackend({
      requested: "audio-worklet",
      context: createContext(emitIssue),
    })

    // worklet first (fails) → falls to media-recorder (next in standard order)
    expect(backend.strategy).toBe("media-recorder")
    expect(emitIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        warning: expect.objectContaining({
          code: RecorderWarningCode.ScriptProcessorFallback,
        }),
      })
    )
  })

  it("throws the last error when every backend is unavailable", async () => {
    const lastErr = new InputBackendUnavailableError("script-processor", "dead")
    mrFactory.mockRejectedValue(
      new InputBackendUnavailableError("media-recorder", "a")
    )
    workletFactory.mockRejectedValue(
      new InputBackendUnavailableError("audio-worklet", "b")
    )
    spFactory.mockRejectedValue(lastErr)

    await expect(
      selectInputBackend({ requested: "auto", context: createContext() })
    ).rejects.toBe(lastErr)
  })

  it("does not emit a fallback warning for the last failed candidate", async () => {
    const emitIssue = vi.fn()
    mrFactory.mockRejectedValue(
      new InputBackendUnavailableError("media-recorder", "a")
    )
    workletFactory.mockRejectedValue(
      new InputBackendUnavailableError("audio-worklet", "b")
    )
    spFactory.mockRejectedValue(
      new InputBackendUnavailableError("script-processor", "c")
    )

    await expect(
      selectInputBackend({
        requested: "auto",
        context: createContext(emitIssue),
      })
    ).rejects.toBeInstanceOf(InputBackendUnavailableError)

    expect(emitIssue).toHaveBeenCalledTimes(2)
    expect(emitIssue.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        warning: expect.objectContaining({
          code: RecorderWarningCode.MediaRecorderFallback,
          message: expect.stringContaining('falling back to "audio-worklet"'),
        }),
      })
    )
    expect(emitIssue.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        warning: expect.objectContaining({
          code: RecorderWarningCode.ScriptProcessorFallback,
          message: expect.stringContaining(
            'falling back to "script-processor"'
          ),
        }),
      })
    )
  })

  it("wraps non-Error failures when no backend can be established", async () => {
    mrFactory.mockRejectedValue("no mr")
    workletFactory.mockRejectedValue("no worklet")
    spFactory.mockRejectedValue("no sp")

    await expect(
      selectInputBackend({ requested: "auto", context: createContext() })
    ).rejects.toThrow("No input backend could be established.")
  })

  it("uses Error.message in fallback warnings for generic errors", async () => {
    mrFactory.mockRejectedValue(new Error("mr exploded"))
    workletFactory.mockResolvedValue(fakeBackend("audio-worklet"))
    const emitIssue = vi.fn()

    await selectInputBackend({
      requested: "auto",
      context: createContext(emitIssue),
    })

    expect(emitIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.MediaRecorderFallback,
        message:
          'Input strategy "media-recorder" unavailable, falling back to "audio-worklet". mr exploded',
      },
    })
  })
})
