import { afterEach, describe, expect, it, vi } from "vitest"
import { ChunkedEncoderBridge } from "../../src/workers/chunked-encoder-bridge"
import { pcmStreamEncoder, wavStreamEncoder } from "../../src/codecs/base"

function mono(samples: number[]): Int16Array[] {
  return [new Int16Array(samples)]
}

class FakeWorker {
  onmessage: ((event: MessageEvent<any>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: unknown[] = []
  terminated = false

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<any>)
  }

  emitError(message?: string): void {
    this.onerror?.({ message } as ErrorEvent)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("ChunkedEncoderBridge", () => {
  it("feeds PCM chunks synchronously via the main-thread fallback", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "pcm",
      definition: pcmStreamEncoder,
    })

    const result = await bridge.feedFrame(1, 16000, mono([100, 200]))
    expect(result).not.toBeNull()
    expect(result!.byteLength).toBe(4)

    bridge.dispose()
  })

  it("flush returns null for the PCM encoder", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "pcm",
      definition: pcmStreamEncoder,
    })

    await bridge.feedFrame(1, 16000, mono([1, 2]))
    await expect(bridge.flush()).resolves.toBeNull()

    bridge.dispose()
  })

  it("WAV bridge accumulates frames and emits on flush", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "wav",
      encoderOptions: { framesPerChunk: 10 },
      definition: wavStreamEncoder,
    })

    expect(await bridge.feedFrame(1, 16000, mono([1, 2, 3]))).toBeNull()

    const final = await bridge.flush()
    expect(final).not.toBeNull()
    expect(final!.byteLength).toBeGreaterThan(44)

    bridge.dispose()
  })

  it("rejects feedFrame and flush after dispose", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "pcm",
      definition: pcmStreamEncoder,
    })
    bridge.dispose()

    await expect(bridge.feedFrame(1, 16000, mono([1]))).rejects.toThrow(
      "disposed"
    )
    await expect(bridge.flush()).rejects.toThrow("disposed")
  })

  it("throws when Worker is unavailable and main-thread fallback is disabled", () => {
    expect(
      () =>
        new ChunkedEncoderBridge({
          format: "pcm",
          definition: pcmStreamEncoder,
          allowMainThreadFallback: false,
        })
    ).toThrow("allowMainThreadFallback")
  })

  it("uses the worker path after the worker reports ready", async () => {
    vi.stubGlobal("Worker", class {})

    const worker = new FakeWorker()
    const bridge = new ChunkedEncoderBridge({
      format: "custom",
      encoderOptions: { bitrate: 128 },
      definition: {
        format: "custom",
        workerFactory: () => worker as unknown as Worker,
        create: vi.fn(() => {
          throw new Error("main-thread fallback should not be used")
        }),
      },
    })

    expect(worker.messages[0]).toEqual({
      type: "init",
      format: "custom",
      options: { bitrate: 128 },
    })

    worker.emitMessage({ type: "ready" })

    const feedPromise = bridge.feedFrame(1, 16000, mono([1, 2]))
    await Promise.resolve()
    expect(worker.messages[1]).toEqual({
      type: "feedFrame",
      planar: mono([1, 2]),
      channels: 1,
      sampleRate: 16000,
      seqId: 0,
    })

    const chunk = new Uint8Array([1, 2, 3])
    worker.emitMessage({ type: "result", result: chunk, seqId: 0 })
    await expect(feedPromise).resolves.toEqual(chunk)

    const flushPromise = bridge.flush()
    await Promise.resolve()
    expect(worker.messages[2]).toEqual({ type: "flush", seqId: 1 })
    worker.emitMessage({ type: "result", result: null, seqId: 1 })
    await expect(flushPromise).resolves.toBeNull()

    bridge.dispose()
    expect(worker.messages[3]).toEqual({ type: "dispose" })
    expect(worker.terminated).toBe(true)
  })

  it("rejects all pending worker operations when the worker errors", async () => {
    vi.stubGlobal("Worker", class {})

    const worker = new FakeWorker()
    const bridge = new ChunkedEncoderBridge({
      format: "custom",
      definition: {
        format: "custom",
        workerFactory: () => worker as unknown as Worker,
        create: () => ({
          feedFrame: () => null,
          flush: () => null,
          dispose: () => undefined,
        }),
      },
    })

    worker.emitMessage({ type: "ready" })

    const feedPromise = bridge.feedFrame(1, 16000, mono([1]))
    const flushPromise = bridge.flush()
    await Promise.resolve()

    worker.emitError("worker blew up")

    await expect(feedPromise).rejects.toThrow("worker blew up")
    await expect(flushPromise).rejects.toThrow("worker blew up")
  })

  it("rejects pending worker operations when disposed", async () => {
    vi.stubGlobal("Worker", class {})

    const worker = new FakeWorker()
    const bridge = new ChunkedEncoderBridge({
      format: "custom",
      definition: {
        format: "custom",
        workerFactory: () => worker as unknown as Worker,
        create: () => ({
          feedFrame: () => null,
          flush: () => null,
          dispose: () => undefined,
        }),
      },
    })

    worker.emitMessage({ type: "ready" })

    const feedPromise = bridge.feedFrame(1, 16000, mono([9]))
    await Promise.resolve()

    bridge.dispose()
    bridge.dispose()

    await expect(feedPromise).rejects.toThrow("ChunkedEncoderBridge disposed")
    expect(worker.terminated).toBe(true)
  })
  it("rejects feedFrame and flush when worker init fails before ready", async () => {
    vi.stubGlobal("Worker", class {})

    const worker = new FakeWorker()
    const bridge = new ChunkedEncoderBridge({
      format: "custom",
      definition: {
        format: "custom",
        workerFactory: () => worker as unknown as Worker,
        create: () => ({
          feedFrame: () => null,
          flush: () => null,
          dispose: () => undefined,
        }),
      },
    })

    worker.emitMessage({ type: "error", message: "init failed", seqId: -1 })

    await expect(bridge.feedFrame(1, 16000, mono([1]))).rejects.toThrow(
      "init failed"
    )
    await expect(bridge.flush()).rejects.toThrow("init failed")
  })

  it("rejects a queued feedFrame when disposed before worker becomes ready", async () => {
    vi.stubGlobal("Worker", class {})

    const worker = new FakeWorker()
    const bridge = new ChunkedEncoderBridge({
      format: "custom",
      definition: {
        format: "custom",
        workerFactory: () => worker as unknown as Worker,
        create: () => ({
          feedFrame: () => null,
          flush: () => null,
          dispose: () => undefined,
        }),
      },
    })

    const feedPromise = bridge.feedFrame(1, 16000, mono([3]))
    await Promise.resolve()

    bridge.dispose()

    await expect(feedPromise).rejects.toThrow("ChunkedEncoderBridge disposed")
  })
  it("falls back to the main thread when worker construction fails", async () => {
    vi.stubGlobal("Worker", class {})

    const bridge = new ChunkedEncoderBridge({
      format: "custom",
      definition: {
        format: "custom",
        workerFactory: () => {
          throw new Error("worker construction failed")
        },
        create: () => ({
          feedFrame: (_channels, _sampleRate, planar) => {
            const firstChannel = planar[0]
            if (!firstChannel) {
              throw new Error("expected at least one channel")
            }

            return Uint8Array.from(
              new Uint8Array(
                firstChannel.buffer,
                firstChannel.byteOffset,
                firstChannel.byteLength
              )
            )
          },
          flush: () => null,
          dispose: () => undefined,
        }),
      },
    })

    await expect(bridge.feedFrame(1, 16000, mono([5, 6]))).resolves.toEqual(
      new Uint8Array([5, 0, 6, 0])
    )
  })

  it("converts main-thread encoder errors into rejected promises", async () => {
    const feedBridge = new ChunkedEncoderBridge({
      format: "feed-error",
      definition: {
        format: "feed-error",
        create: () => ({
          feedFrame: () => {
            throw "feed failed"
          },
          flush: () => null,
          dispose: () => undefined,
        }),
      },
    })
    const flushBridge = new ChunkedEncoderBridge({
      format: "flush-error",
      definition: {
        format: "flush-error",
        create: () => ({
          feedFrame: () => null,
          flush: () => {
            throw "flush failed"
          },
          dispose: () => undefined,
        }),
      },
    })

    await expect(feedBridge.feedFrame(1, 16000, mono([1]))).rejects.toThrow(
      "feed failed"
    )
    await expect(flushBridge.flush()).rejects.toThrow("flush failed")
  })

  it("recreates the main-thread encoder on reset", async () => {
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    const create = vi
      .fn()
      .mockReturnValueOnce({
        feedFrame: () => new Uint8Array([1]),
        flush: () => null,
        dispose: firstDispose,
      })
      .mockReturnValueOnce({
        feedFrame: () => new Uint8Array([2]),
        flush: () => null,
        dispose: secondDispose,
      })

    const bridge = new ChunkedEncoderBridge({
      format: "resettable",
      encoderOptions: { mode: "first" },
      definition: {
        format: "resettable",
        create,
      },
    })

    bridge.reset({ mode: "second" })

    await expect(bridge.feedFrame(1, 16000, mono([1]))).resolves.toEqual(
      new Uint8Array([2])
    )
    expect(firstDispose).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenNthCalledWith(1, { mode: "first" })
    expect(create).toHaveBeenNthCalledWith(2, { mode: "second" })

    bridge.dispose()
    expect(secondDispose).toHaveBeenCalledTimes(1)
  })

  it("falls back to the main thread when definition has no workerFactory", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "no-worker",
      definition: {
        format: "no-worker",
        create: () => ({
          feedFrame: () => new Uint8Array([42]),
          flush: () => null,
          dispose: () => undefined,
        }),
      },
    })

    await expect(bridge.feedFrame(1, 16000, mono([1]))).resolves.toEqual(
      new Uint8Array([42])
    )
    bridge.dispose()
  })
})
