import { beforeEach, describe, expect, it, vi } from "vitest"
import { createScriptProcessorBackend } from "@/input/backends/script-processor-backend"
import type { InputBackendContext } from "@/input/backends/types"

type AudioProcessHandler = ((event: Event) => void) | null

function createAudioContextStub() {
  const scriptProcessor = {
    onaudioprocess: null as AudioProcessHandler,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  const sourceNode = { connect: vi.fn(), disconnect: vi.fn() }
  const sinkNode = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  }
  return {
    sampleRate: 48_000,
    destination: {},
    createScriptProcessor: vi.fn(() => scriptProcessor),
    createMediaStreamSource: vi.fn(() => sourceNode),
    createGain: vi.fn(() => sinkNode),
    __scriptProcessor: scriptProcessor,
    __sourceNode: sourceNode,
    __sinkNode: sinkNode,
  }
}

function createContext(
  audioContext: unknown,
  sink: InputBackendContext["sink"]
) {
  return {
    audioContext: audioContext as AudioContext,
    stream: {} as MediaStream,
    channelCount: 1,
    sink,
    emitIssue: vi.fn(),
  } as InputBackendContext
}

describe("createScriptProcessorBackend", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("wires source → scriptProcessor → sinkGain(0) → destination and reports strategy", async () => {
    const audioContext = createAudioContextStub()
    const backend = await createScriptProcessorBackend(
      createContext(audioContext, { acceptFrame: vi.fn() })
    )

    expect(backend.strategy).toBe("script-processor")
    expect(audioContext.createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1)
    expect(audioContext.__sinkNode.gain.value).toBe(0)
    expect(audioContext.__sourceNode.connect).toHaveBeenCalledWith(
      audioContext.__scriptProcessor
    )
    expect(audioContext.__scriptProcessor.connect).toHaveBeenCalledWith(
      audioContext.__sinkNode
    )
    expect(audioContext.__sinkNode.connect).toHaveBeenCalledWith(
      audioContext.destination
    )
  })

  it("routes onaudioprocess frames to the sink with resolved channel count", async () => {
    const audioContext = createAudioContextStub()
    const acceptFrame = vi.fn()
    const backend = await createScriptProcessorBackend(
      createContext(audioContext, { acceptFrame })
    )

    const channelData = new Float32Array([0.25, -0.25])
    audioContext.__scriptProcessor.onaudioprocess?.({
      inputBuffer: {
        numberOfChannels: 1,
        getChannelData: vi.fn(() => channelData),
      },
    } as unknown as Event)

    expect(acceptFrame).toHaveBeenCalledTimes(1)
    expect(acceptFrame.mock.calls[0]?.[0]).toEqual([channelData])
    expect(typeof acceptFrame.mock.calls[0]?.[1]).toBe("number")

    backend.dispose()
    expect(audioContext.__scriptProcessor.onaudioprocess).toBeNull()
    expect(audioContext.__sourceNode.disconnect).toHaveBeenCalled()
  })

  it("suspend/resume are no-ops (frame gating handled by session)", async () => {
    const audioContext = createAudioContextStub()
    const backend = await createScriptProcessorBackend(
      createContext(audioContext, { acceptFrame: vi.fn() })
    )
    expect(() => {
      backend.suspend()
      backend.resume()
    }).not.toThrow()
  })
})
