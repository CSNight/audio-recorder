import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInputGraph } from "@/input/input-graph"
import { RecorderWarningCode } from "@/types"

type AudioProcessHandler = ((event: Event) => void) | null

function createAudioContextStub(): AudioContext & {
  __scriptProcessor: ScriptProcessorNode & {
    onaudioprocess: AudioProcessHandler
  }
} {
  const scriptProcessor = {
    onaudioprocess: null as AudioProcessHandler,
  } as ScriptProcessorNode & {
    onaudioprocess: AudioProcessHandler
  }

  return {
    createScriptProcessor: vi.fn(() => scriptProcessor),
    audioWorklet: undefined,
    sampleRate: 48_000,
  } as unknown as AudioContext & {
    __scriptProcessor: ScriptProcessorNode & {
      onaudioprocess: AudioProcessHandler
    }
  }
}

describe("createInputGraph", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("falls back to ScriptProcessor when AudioWorkletNode is unavailable", async () => {
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    const onIssue = vi.fn()
    const onFrame = vi.fn()
    const audioContext = createAudioContextStub()

    const graph = await createInputGraph(audioContext, 2, {
      onFrame,
      onIssue,
    })

    expect(audioContext.createScriptProcessor).toHaveBeenCalledWith(4096, 2, 2)
    expect(graph.inputNode).toBeDefined()
    expect(onIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.ScriptProcessorFallback,
        message:
          "AudioWorklet is unavailable, falling back to ScriptProcessor. AudioWorkletNode is not supported in this browser.",
      },
    })
  })

  it("routes ScriptProcessor frames into the bound session and can deactivate the handler", async () => {
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    const audioContext = createAudioContextStub()
    const graph = await createInputGraph(audioContext, 1, {
      onFrame: vi.fn(),
      onIssue: vi.fn(),
    })
    const acceptFrame = vi.fn()

    graph.bindSession({
      acceptFrame,
    } as unknown as Parameters<typeof graph.bindSession>[0])

    const channelData = new Float32Array([0.25, -0.25])
    const processEvent = {
      inputBuffer: {
        numberOfChannels: 1,
        getChannelData: vi.fn(() => channelData),
      },
    } as unknown as Event

    const scriptProcessor = graph.inputNode as ScriptProcessorNode & {
      onaudioprocess: AudioProcessHandler
    }
    scriptProcessor.onaudioprocess?.(processEvent)

    expect(acceptFrame).toHaveBeenCalledTimes(1)
    expect(acceptFrame.mock.calls[0]?.[0]).toEqual([channelData])
    expect(typeof acceptFrame.mock.calls[0]?.[1]).toBe("number")

    graph.deactivateInputNode()
    expect(scriptProcessor.onaudioprocess).toBeNull()
  })

  it("registers the worklet once per AudioContext and routes worklet frames and errors", async () => {
    const createdNodes: Array<{
      port: {
        onmessage: ((event: MessageEvent<unknown>) => void) | null
      }
      name: string
      options?: AudioWorkletNodeOptions | undefined
    }> = []

    class FakeAudioWorkletNode {
      public readonly port = {
        onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
      }

      constructor(
        _context: BaseAudioContext,
        public readonly name: string,
        public readonly options: AudioWorkletNodeOptions | undefined = undefined
      ) {
        createdNodes.push(this)
      }
    }

    const addModule = vi.fn(async () => {})
    const createScriptProcessor = vi.fn()
    const audioContext = {
      audioWorklet: {
        addModule,
      },
      createScriptProcessor,
      sampleRate: 48_000,
    } as unknown as AudioContext
    const onIssue = vi.fn()
    const acceptFrame = vi.fn()

    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recorder-worklet")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    vi.spyOn(performance, "now").mockReturnValue(1234)

    const firstGraph = await createInputGraph(audioContext, 2, {
      onFrame: vi.fn(),
      onIssue,
    })
    const secondGraph = await createInputGraph(audioContext, 2, {
      onFrame: vi.fn(),
      onIssue,
    })

    expect(addModule).toHaveBeenCalledTimes(1)
    expect(createdNodes[0]?.name).toBe("audio-recorder-frame-processor")
    expect(createdNodes[0]?.options).toMatchObject({
      channelCount: 2,
      outputChannelCount: [2],
    })
    expect(createdNodes[1]?.name).toBe("audio-recorder-frame-processor")
    expect(secondGraph.inputNode).toBeDefined()

    createdNodes[0]?.port.onmessage?.({
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
    expect(acceptFrame).not.toHaveBeenCalled()

    firstGraph.bindSession({
      acceptFrame,
    } as unknown as Parameters<typeof firstGraph.bindSession>[0])

    createdNodes[0]?.port.onmessage?.({
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
    createdNodes[0]?.port.onmessage?.({
      data: {
        type: "worklet-error",
        message: "Synthetic worklet failure.",
      },
    } as MessageEvent<unknown>)

    expect(acceptFrame).toHaveBeenCalledTimes(1)
    expect(acceptFrame.mock.calls[0]?.[0]).toEqual([new Float32Array([0.1])])
    expect(acceptFrame.mock.calls[0]?.[1]).toBe(1234)
    expect(onIssue).toHaveBeenCalledWith({
      kind: "error",
      error: new Error("Synthetic worklet failure."),
    })

    firstGraph.deactivateInputNode()
    expect(createdNodes[0]?.port.onmessage).toBeNull()
    expect(createScriptProcessor).not.toHaveBeenCalled()
  })

  it("passes batchSamples > 0 via processorOptions on mobile UA", async () => {
    const createdOptions: AudioWorkletNodeOptions[] = []

    class FakeAudioWorkletNode {
      public readonly port = {
        onmessage: null,
      }

      constructor(
        _context: BaseAudioContext,
        _name: string,
        options?: AudioWorkletNodeOptions
      ) {
        if (options) createdOptions.push(options)
      }
    }

    const addModule = vi.fn(async () => {})
    const audioContext = {
      audioWorklet: { addModule },
      createScriptProcessor: vi.fn(),
      sampleRate: 48_000,
    } as unknown as AudioContext

    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode)
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    })
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recorder-worklet")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})

    await createInputGraph(audioContext, 1, {
      onFrame: vi.fn(),
      onIssue: vi.fn(),
    })

    const processorOptions = createdOptions[0]?.processorOptions as
      | { batchSamples?: number }
      | undefined
    expect(processorOptions?.batchSamples).toBeGreaterThan(0)
    // 48000 / 60 = 800
    expect(processorOptions?.batchSamples).toBe(800)
  })

  it("passes batchSamples = 0 via processorOptions on desktop UA", async () => {
    const createdOptions: AudioWorkletNodeOptions[] = []

    class FakeAudioWorkletNode {
      public readonly port = {
        onmessage: null,
      }

      constructor(
        _context: BaseAudioContext,
        _name: string,
        options?: AudioWorkletNodeOptions
      ) {
        if (options) createdOptions.push(options)
      }
    }

    const addModule = vi.fn(async () => {})
    const audioContext = {
      audioWorklet: { addModule },
      createScriptProcessor: vi.fn(),
      sampleRate: 48_000,
    } as unknown as AudioContext

    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode)
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    })
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recorder-worklet")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})

    await createInputGraph(audioContext, 1, {
      onFrame: vi.fn(),
      onIssue: vi.fn(),
    })

    const processorOptions = createdOptions[0]?.processorOptions as
      | { batchSamples?: number }
      | undefined
    expect(processorOptions?.batchSamples).toBe(0)
  })

  it("falls back to ScriptProcessor when AudioWorkletNode exists but audioContext.audioWorklet is undefined", async () => {
    class FakeAudioWorkletNode {
      public readonly port = { onmessage: null }
      constructor() {}
    }

    const audioContext = createAudioContextStub()
    // audioWorklet is undefined on the context even though AudioWorkletNode is globally available
    ;(audioContext as unknown as { audioWorklet: undefined }).audioWorklet =
      undefined

    const onIssue = vi.fn()

    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recorder-worklet")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})

    const graph = await createInputGraph(audioContext, 1, {
      onFrame: vi.fn(),
      onIssue,
    })

    expect(audioContext.createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1)
    expect(graph.inputNode).toBeDefined()
    expect(onIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.ScriptProcessorFallback,
        message:
          "AudioWorklet is unavailable, falling back to ScriptProcessor. AudioWorklet is not available in the current AudioContext.",
      },
    })
  })
})

describe("createInputGraph — MediaRecorder first tier", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function createStreamStub(): MediaStream {
    return {
      getAudioTracks: () => [{}],
      getTracks: () => [{}],
    } as unknown as MediaStream
  }

  function buildFakeMediaRecorder(opts: {
    autoFire?: boolean
    fireDelay?: number
    throwOnStart?: boolean
    throwOnNew?: boolean
  } = {}) {
    let _ondataavailable: ((e: BlobEvent) => void) | null = null
    let _onerror: (() => void) | null = null
    let _onstart: (() => void) | null = null
    let started = false

    const instance = {
      get ondataavailable() { return _ondataavailable },
      set ondataavailable(fn: ((e: BlobEvent) => void) | null) { _ondataavailable = fn },
      get onerror() { return _onerror },
      set onerror(fn: (() => void) | null) { _onerror = fn },
      get onstart() { return _onstart },
      set onstart(fn: (() => void) | null) { _onstart = fn },
      start(_timeslice?: number) {
        if (opts.throwOnStart) throw new Error("start failed")
        started = true
        if (opts.autoFire !== false) {
          const delay = opts.fireDelay ?? 0
          setTimeout(() => {
            // 触发 onstart 表示 MediaRecorder 进入 recording 状态
            if (_onstart) _onstart()
            if (_ondataavailable) {
              const blob = new Blob([new Uint8Array(4)], { type: "audio/webm" })
              _ondataavailable({ data: blob } as BlobEvent)
            }
          }, delay)
        }
        // autoFire=false 时不触发 onstart，模拟超时场景
      },
      stop() {},
      get started() { return started },
    }
    return instance
  }

  it("skips MediaRecorder path when preferMediaRecorder is false", async () => {
    const isTypeSupported = vi.fn(() => true)
    vi.stubGlobal("MediaRecorder", { isTypeSupported })
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })

    const audioContext = createAudioContextStub()
    const stream = createStreamStub()

    await createInputGraph(audioContext, 1, { onFrame: vi.fn(), onIssue: vi.fn() }, {
      preferMediaRecorder: false,
      stream,
    })

    expect(isTypeSupported).not.toHaveBeenCalled()
  })

  it("skips MediaRecorder path when no stream is provided", async () => {
    const isTypeSupported = vi.fn(() => true)
    vi.stubGlobal("MediaRecorder", { isTypeSupported })
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })

    const audioContext = createAudioContextStub()

    await createInputGraph(audioContext, 1, { onFrame: vi.fn(), onIssue: vi.fn() })

    // No stream passed — MediaRecorder path not entered
    expect(isTypeSupported).not.toHaveBeenCalled()
  })

  it("falls through to ScriptProcessor when isTypeSupported returns false", async () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false })
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })

    const audioContext = createAudioContextStub()
    const stream = createStreamStub()
    const onIssue = vi.fn()

    const graph = await createInputGraph(audioContext, 1, { onFrame: vi.fn(), onIssue }, {
      stream,
    })

    // Falls through to ScriptProcessor
    expect(graph.inputNode).toBeDefined()
    expect(audioContext.createScriptProcessor).toHaveBeenCalled()
  })

  it("emits MediaRecorderFallback warning and falls back when start throws", async () => {
    const mr = buildFakeMediaRecorder({ throwOnStart: true })
    const MediaRecorderCtor = vi.fn(() => mr)
    ;(MediaRecorderCtor as unknown as { isTypeSupported: () => boolean }).isTypeSupported = () => true
    vi.stubGlobal("MediaRecorder", MediaRecorderCtor)
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (_fn: TimerHandler) => { return 0 as unknown as ReturnType<typeof setTimeout> }
    )

    const audioContext = {
      ...createAudioContextStub(),
      createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
    } as unknown as AudioContext
    const stream = createStreamStub()
    const onIssue = vi.fn()

    const graph = await createInputGraph(audioContext, 1, { onFrame: vi.fn(), onIssue }, { stream })

    // Should have fallen back to ScriptProcessor
    expect(audioContext.createScriptProcessor).toHaveBeenCalled()
    expect(onIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        warning: expect.objectContaining({ code: RecorderWarningCode.MediaRecorderFallback }),
      })
    )
    expect(graph.inputNode).toBeDefined()
  })

  it("emits MediaRecorderFallback warning and falls back on 500ms timeout", async () => {
    vi.useFakeTimers()

    const mr = buildFakeMediaRecorder({ autoFire: false })
    const MediaRecorderCtor = vi.fn(() => mr)
    ;(MediaRecorderCtor as unknown as { isTypeSupported: () => boolean }).isTypeSupported = () => true
    vi.stubGlobal("MediaRecorder", MediaRecorderCtor)
    vi.stubGlobal("AudioWorkletNode", undefined)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })

    const audioContext = {
      ...createAudioContextStub(),
      createMediaStreamSource: vi.fn(() => ({})),
    } as unknown as AudioContext
    const stream = createStreamStub()
    const onIssue = vi.fn()

    const graphPromise = createInputGraph(audioContext, 1, { onFrame: vi.fn(), onIssue }, { stream })

    // Advance past the 500ms timeout
    await vi.advanceTimersByTimeAsync(600)
    const graph = await graphPromise

    expect(graph.inputNode).toBeDefined()
    expect(onIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        warning: expect.objectContaining({ code: RecorderWarningCode.MediaRecorderFallback }),
      })
    )

    vi.useRealTimers()
  })
})

describe("createInputGraph — worklet registration failure", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("falls back to ScriptProcessor when worklet registration throws", async () => {
    class FakeAudioWorkletNode {
      public readonly port = {
        onmessage: null,
      }

      constructor(
        _context: BaseAudioContext,
        _name: string,
        _options?: AudioWorkletNodeOptions
      ) {}
    }

    const audioContext = {
      createScriptProcessor: vi.fn(() => ({ onaudioprocess: null })),
      audioWorklet: undefined as unknown,
      sampleRate: 48_000,
    } as unknown as AudioContext
    const addModule = vi.fn(async () => {
      throw new Error("register failed")
    })
    const onIssue = vi.fn()

    vi.stubGlobal("AudioWorkletNode", FakeAudioWorkletNode)
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" })
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recorder-worklet")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    ;(
      audioContext as unknown as AudioContext & {
        audioWorklet?: {
          addModule: typeof addModule
        }
      }
    ).audioWorklet = {
      addModule,
    }

    const graph = await createInputGraph(audioContext, 1, {
      onFrame: vi.fn(),
      onIssue,
    })

    expect(addModule).toHaveBeenCalledTimes(1)
    expect(audioContext.createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1)
    expect(graph.inputNode).toBeDefined()
    expect(onIssue).toHaveBeenCalledWith({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.ScriptProcessorFallback,
        message:
          "AudioWorklet is unavailable, falling back to ScriptProcessor. register failed",
      },
    })
  })
})
