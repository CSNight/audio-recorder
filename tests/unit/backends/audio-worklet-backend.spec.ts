import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAudioWorkletBackend } from "@/input/backends/audio-worklet-backend"
import { InputBackendUnavailableError } from "@/input/backends/types"
import type { InputBackendContext } from "@/input/backends/types"

function createAudioContextStub(addModule = vi.fn(async () => {})) {
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() }
  const sinkNode = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  return {
    sampleRate: 48_000,
    destination: {},
    audioWorklet: { addModule },
    createMediaStreamSource: vi.fn(() => sourceNode),
    createGain: vi.fn(() => sinkNode),
    __sourceNode: sourceNode,
    __sinkNode: sinkNode,
  }
}

function createContext(
  audioContext: unknown,
  sink: InputBackendContext["sink"],
  emitIssue = vi.fn(),
  channelCount: 1 | 2 = 2
): InputBackendContext {
  return {
    audioContext: audioContext as AudioContext,
    stream: {} as MediaStream,
    channelCount,
    sink,
    emitIssue,
  }
}

describe("createAudioWorkletBackend", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recorder-worklet")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  })

  it("throws InputBackendUnavailableError when AudioWorkletNode is absent", async () => {
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    const audioContext = createAudioContextStub()

    await expect(
      createAudioWorkletBackend(
        createContext(audioContext, { acceptFrame: vi.fn() })
      )
    ).rejects.toBeInstanceOf(InputBackendUnavailableError)
  })

  it("throws InputBackendUnavailableError when registration fails", async () => {
    class FakeNode {
      port = { onmessage: null }
    }
    const addModule = vi.fn(async () => {
      throw new Error("register failed")
    })
    vi.stubGlobal("AudioWorkletNode", FakeNode)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    const audioContext = createAudioContextStub(addModule)

    await expect(
      createAudioWorkletBackend(
        createContext(audioContext, { acceptFrame: vi.fn() })
      )
    ).rejects.toBeInstanceOf(InputBackendUnavailableError)
    expect(addModule).toHaveBeenCalledTimes(1)
  })

  it("registers once per AudioContext, routes frames and worklet errors", async () => {
    const created: Array<{
      name: string
      options: AudioWorkletNodeOptions | undefined
      port: { onmessage: ((e: MessageEvent<unknown>) => void) | null }
    }> = []
    class FakeNode {
      port = {
        onmessage: null as ((e: MessageEvent<unknown>) => void) | null,
      }
      connect = vi.fn()
      disconnect = vi.fn()
      constructor(
        _ctx: BaseAudioContext,
        public name: string,
        public options?: AudioWorkletNodeOptions
      ) {
        created.push({
          name,
          options,
          port: this.port,
        })
      }
    }
    vi.stubGlobal("AudioWorkletNode", FakeNode)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    vi.spyOn(performance, "now").mockReturnValue(1234)

    const audioContext = createAudioContextStub()
    const acceptFrame = vi.fn()
    const emitIssue = vi.fn()

    const backend1 = await createAudioWorkletBackend(
      createContext(audioContext, { acceptFrame }, emitIssue)
    )
    await createAudioWorkletBackend(
      createContext(audioContext, { acceptFrame: vi.fn() }, emitIssue)
    )

    expect(audioContext.audioWorklet.addModule).toHaveBeenCalledTimes(1)
    expect(backend1.strategy).toBe("audio-worklet")
    expect(created[0]?.name).toBe("audio-recorder-frame-processor")
    expect(created[0]?.options).toMatchObject({
      channelCount: 2,
      channelCountMode: "clamped-max",
    })

    // frame: 现在保留所有声道（3个声道全部保留）
    created[0]?.port.onmessage?.({
      data: {
        type: "frame",
        planar: [
          new Float32Array([0.1]),
          new Float32Array([0.2]),
          new Float32Array([0.3]),
        ],
        channelCount: 3,
      },
    } as MessageEvent<unknown>)
    expect(acceptFrame).toHaveBeenCalledTimes(1)
    expect(acceptFrame.mock.calls[0]?.[0]).toEqual([
      new Float32Array([0.1]),
      new Float32Array([0.2]),
      new Float32Array([0.3]),
    ])
    expect(acceptFrame.mock.calls[0]?.[1]).toBe(1234)

    created[0]?.port.onmessage?.({
      data: { type: "worklet-error", message: "Synthetic failure." },
    } as MessageEvent<unknown>)
    expect(emitIssue).toHaveBeenCalledWith({
      kind: "error",
      error: new Error("Synthetic failure."),
    })

    backend1.dispose()
    expect(created[0]?.port.onmessage).toBeNull()
  })

  it("uses batchSamples > 0 on mobile UA, 0 on desktop UA", async () => {
    const created: AudioWorkletNodeOptions[] = []
    class FakeNode {
      port = { onmessage: null }
      connect = vi.fn()
      disconnect = vi.fn()
      constructor(
        _ctx: BaseAudioContext,
        _name: string,
        options?: AudioWorkletNodeOptions
      ) {
        if (options) created.push(options)
      }
    }
    vi.stubGlobal("AudioWorkletNode", FakeNode)

    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    })
    await createAudioWorkletBackend(
      createContext(createAudioContextStub(), { acceptFrame: vi.fn() })
    )
    expect(
      (created[0]?.processorOptions as { batchSamples?: number })?.batchSamples
    ).toBe(800) // 48000 / 60

    created.length = 0
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    })
    await createAudioWorkletBackend(
      createContext(createAudioContextStub(), { acceptFrame: vi.fn() })
    )
    expect(
      (created[0]?.processorOptions as { batchSamples?: number })?.batchSamples
    ).toBe(0)
  })
})
