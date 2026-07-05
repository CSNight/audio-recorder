import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SonicStreamEncoderBridge } from "../../src/plugins/sonic-export/encoder-bridge"
import type { StreamEncoderDefinition } from "../../src"

function makeMockDefinition(
  overrides: Partial<StreamEncoderDefinition> = {}
): StreamEncoderDefinition {
  const encoder = {
    feedFrame: vi.fn().mockReturnValue(null),
    flush: vi.fn().mockReturnValue(null),
    dispose: vi.fn(),
  }
  return {
    create: vi.fn().mockReturnValue(encoder),
    workerFactory: undefined,
    ...overrides,
  } as unknown as StreamEncoderDefinition
}

// Helper to create a mock Worker that behaves like the encoder worker
function makeMockWorker() {
  let onmessage: ((event: MessageEvent) => void) | null = null
  let onerror: ((event: ErrorEvent) => void) | null = null
  const postedMessages: unknown[] = []

  return {
    postMessage: vi.fn((msg: unknown) => {
      postedMessages.push(msg)
    }),
    terminate: vi.fn(),
    get onmessage() {
      return onmessage
    },
    set onmessage(handler: ((event: MessageEvent) => void) | null) {
      onmessage = handler
    },
    get onerror() {
      return onerror
    },
    set onerror(handler: ((event: ErrorEvent) => void) | null) {
      onerror = handler
    },
    // Test helpers
    _simulateReady() {
      onmessage?.({ data: { type: "ready" } } as MessageEvent)
    },
    _simulateResult(seqId: number, result: Uint8Array | null) {
      onmessage?.({ data: { type: "result", seqId, result } } as MessageEvent)
    },
    _simulateError(seqId: number, message: string) {
      onmessage?.({ data: { type: "error", seqId, message } } as MessageEvent)
    },
    _simulateInitError(message: string) {
      onmessage?.({
        data: { type: "error", seqId: -1, message },
      } as MessageEvent)
    },
    _simulateWorkerError(message: string) {
      onerror?.({ message } as ErrorEvent)
    },
    _postedMessages: postedMessages,
  }
}

describe("SonicStreamEncoderBridge (worker-based)", () => {
  // We need Worker to be defined for the worker branch to be taken
  let originalWorker: typeof Worker | undefined
  beforeEach(() => {
    originalWorker = (globalThis as any).Worker
    ;(globalThis as any).Worker = class {}
  })
  afterEach(() => {
    if (originalWorker === undefined) {
      delete (globalThis as any).Worker
    } else {
      ;(globalThis as any).Worker = originalWorker
    }
  })

  it("uses worker when workerFactory is provided", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    // Worker should have been set up
    expect(def.workerFactory).toHaveBeenCalledOnce()
    expect(mockWorker.postMessage).toHaveBeenCalledWith({
      type: "init",
      format: "pcm",
      options: undefined,
    })
    // Should NOT create main-thread encoder
    expect(def.create).not.toHaveBeenCalled()
    bridge.dispose()
  })

  it("feedFrame via worker resolves with result after ready", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateReady()

    const planar = [new Int16Array([100, 200])]
    const feedPromise = bridge.feedFrame(1, 16000, planar)

    // feedFrame awaits readyPromise before posting - need a microtask flush
    await Promise.resolve()

    const feedMsg = mockWorker._postedMessages.find(
      (m: any) => m.type === "feedFrame"
    ) as any
    expect(feedMsg).toBeDefined()
    mockWorker._simulateResult(feedMsg.seqId, new Uint8Array([1, 2, 3]))

    const result = await feedPromise
    expect(result).toEqual(new Uint8Array([1, 2, 3]))
    bridge.dispose()
  })

  it("flush via worker resolves with result after ready", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateReady()

    const flushPromise = bridge.flush()

    // flush awaits readyPromise before posting - need a microtask flush
    await Promise.resolve()

    const flushMsg = mockWorker._postedMessages.find(
      (m: any) => m.type === "flush"
    ) as any
    expect(flushMsg).toBeDefined()
    mockWorker._simulateResult(flushMsg.seqId, new Uint8Array([9, 8]))

    const result = await flushPromise
    expect(result).toEqual(new Uint8Array([9, 8]))
    bridge.dispose()
  })

  it("feedFrame rejects when worker returns error message", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateReady()

    const feedPromise = bridge.feedFrame(1, 16000, [new Int16Array([1])])

    await Promise.resolve()

    const feedMsg = mockWorker._postedMessages.find(
      (m: any) => m.type === "feedFrame"
    ) as any
    mockWorker._simulateError(feedMsg.seqId, "encoder error")

    await expect(feedPromise).rejects.toThrow("encoder error")
    bridge.dispose()
  })

  it("worker init error rejects readyPromise and feedFrame", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateInitError("init failed")

    await expect(bridge.feedFrame(1, 16000, [])).rejects.toThrow("init failed")
    bridge.dispose()
  })

  it("worker onerror rejects pending feedFrame", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateReady()

    const feedPromise = bridge.feedFrame(1, 16000, [new Int16Array([1])])
    mockWorker._simulateWorkerError("crash")

    await expect(feedPromise).rejects.toThrow("crash")
    bridge.dispose()
  })

  it("reset on worker posts reset message and creates new ready promise", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateReady()
    bridge.reset({ bitrate: 64000 })

    const resetMsg = mockWorker._postedMessages.find(
      (m: any) => m.type === "reset"
    ) as any
    expect(resetMsg).toBeDefined()
    expect(resetMsg.options).toEqual({ bitrate: 64000 })
    bridge.dispose()
  })

  it("dispose terminates worker and rejects pending promises", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateReady()

    const feedPromise = bridge.feedFrame(1, 16000, [new Int16Array([1])])
    bridge.dispose()

    expect(mockWorker.terminate).toHaveBeenCalledOnce()
    await expect(feedPromise).rejects.toThrow("disposed")
  })

  it("feedFrame rejects immediately when disposed (worker path)", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateReady()
    bridge.dispose()

    await expect(bridge.feedFrame(1, 16000, [])).rejects.toThrow("disposed")
  })

  it("flush rejects immediately when disposed (worker path)", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateReady()
    bridge.dispose()

    await expect(bridge.flush()).rejects.toThrow("disposed")
  })

  it("feedFrame rejects immediately when workerError is already set", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    // Trigger init error first so workerError is set before feedFrame
    mockWorker._simulateInitError("prior error")
    // Allow microtasks to settle
    await Promise.resolve()

    await expect(bridge.feedFrame(1, 16000, [])).rejects.toThrow("prior error")
    bridge.dispose()
  })

  it("flush rejects immediately when workerError is already set", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    // Trigger init error first so workerError is set before flush
    mockWorker._simulateInitError("prior flush error")
    await Promise.resolve()

    await expect(bridge.flush()).rejects.toThrow("prior flush error")
    bridge.dispose()
  })

  it("falls back to main thread when workerFactory throws", () => {
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockImplementation(() => {
        throw new Error("Worker not supported")
      }),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    // Should have fallen back to main thread
    expect(def.create).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it("unknown seqId message is silently ignored", async () => {
    const mockWorker = makeMockWorker()
    const def = makeMockDefinition({
      workerFactory: vi.fn().mockReturnValue(mockWorker),
    })

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    mockWorker._simulateReady()

    // Send result for a seqId that was never registered
    expect(() =>
      mockWorker._simulateResult(9999, new Uint8Array([1]))
    ).not.toThrow()

    bridge.dispose()
  })
})

describe("SonicStreamEncoderBridge (main-thread fallback)", () => {
  it("creates encoder via definition.create when no Worker", async () => {
    const def = makeMockDefinition()
    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })
    expect(def.create).toHaveBeenCalledOnce()
    bridge.dispose()
  })

  it("feedFrame delegates to main-thread encoder", async () => {
    const mockEncoder = {
      feedFrame: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      flush: vi.fn().mockReturnValue(null),
      dispose: vi.fn(),
    }
    const def = makeMockDefinition()
    ;(def.create as ReturnType<typeof vi.fn>).mockReturnValue(mockEncoder)

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    const planar = [new Int16Array([100, 200, 300])]
    const result = await bridge.feedFrame(1, 16000, planar)
    expect(result).toEqual(new Uint8Array([1, 2, 3]))
    expect(mockEncoder.feedFrame).toHaveBeenCalledWith(1, 16000, planar)
    bridge.dispose()
  })

  it("flush delegates to main-thread encoder", async () => {
    const mockEncoder = {
      feedFrame: vi.fn().mockReturnValue(null),
      flush: vi.fn().mockReturnValue(new Uint8Array([9, 8, 7])),
      dispose: vi.fn(),
    }
    const def = makeMockDefinition()
    ;(def.create as ReturnType<typeof vi.fn>).mockReturnValue(mockEncoder)

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    const result = await bridge.flush()
    expect(result).toEqual(new Uint8Array([9, 8, 7]))
    bridge.dispose()
  })

  it("feedFrame rejects when disposed", async () => {
    const def = makeMockDefinition()
    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })
    bridge.dispose()
    await expect(bridge.feedFrame(1, 16000, [])).rejects.toThrow("disposed")
  })

  it("flush rejects when disposed", async () => {
    const def = makeMockDefinition()
    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })
    bridge.dispose()
    await expect(bridge.flush()).rejects.toThrow("disposed")
  })

  it("dispose is idempotent", () => {
    const def = makeMockDefinition()
    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })
    expect(() => {
      bridge.dispose()
      bridge.dispose()
    }).not.toThrow()
  })

  it("reset recreates main-thread encoder", () => {
    const def = makeMockDefinition()
    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })
    bridge.reset({ newOption: true })
    // create called once at init, once at reset
    expect(def.create).toHaveBeenCalledTimes(2)
    bridge.dispose()
  })

  it("throws when allowMainThreadFallback is false and no Worker", () => {
    const def = makeMockDefinition()
    expect(
      () =>
        new SonicStreamEncoderBridge({
          format: "pcm",
          definition: def,
          allowMainThreadFallback: false,
        })
    ).toThrow("allowMainThreadFallback")
  })

  it("feedFrame rejects when encoder throws", async () => {
    const mockEncoder = {
      feedFrame: vi.fn().mockImplementation(() => {
        throw new Error("encoder error")
      }),
      flush: vi.fn().mockReturnValue(null),
      dispose: vi.fn(),
    }
    const def = makeMockDefinition()
    ;(def.create as ReturnType<typeof vi.fn>).mockReturnValue(mockEncoder)

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    await expect(bridge.feedFrame(1, 16000, [])).rejects.toThrow(
      "encoder error"
    )
    bridge.dispose()
  })

  it("flush rejects when encoder throws", async () => {
    const mockEncoder = {
      feedFrame: vi.fn().mockReturnValue(null),
      flush: vi.fn().mockImplementation(() => {
        throw new Error("flush error")
      }),
      dispose: vi.fn(),
    }
    const def = makeMockDefinition()
    ;(def.create as ReturnType<typeof vi.fn>).mockReturnValue(mockEncoder)

    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      definition: def,
    })

    await expect(bridge.flush()).rejects.toThrow("flush error")
    bridge.dispose()
  })

  it("passes encoderOptions to definition.create", () => {
    const def = makeMockDefinition()
    const opts = { bitrate: 128000 }
    const bridge = new SonicStreamEncoderBridge({
      format: "pcm",
      encoderOptions: opts,
      definition: def,
    })
    expect(def.create).toHaveBeenCalledWith(opts)
    bridge.dispose()
  })
})
