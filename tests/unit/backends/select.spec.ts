import { beforeEach, describe, expect, it, vi } from "vitest"

const mrFactory = vi.hoisted(() => vi.fn())
const workletFactory = vi.hoisted(() => vi.fn())
const spFactory = vi.hoisted(() => vi.fn())

vi.mock("@/input/backends/media-recorder-backend", () => ({
  createMediaRecorderBackend: mrFactory,
}))
vi.mock("@/input/backends/audio-worklet-backend", () => ({
  createAudioWorkletBackend: workletFactory,
}))
vi.mock("@/input/backends/script-processor-backend", () => ({
  createScriptProcessorBackend: spFactory,
}))

import { selectInputBackend } from "@/input/backends/select"
import { InputBackendUnavailableError } from "@/input/backends/types"
import type { InputBackendContext } from "@/input/backends/types"
import { RecorderWarningCode } from "@/types"

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
})
