import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChunkedEncoder } from "@/plugins/streaming-export/types"

type WorkerMessageEvent = { data: unknown }

const selfStub: {
  postMessage: ReturnType<typeof vi.fn>
  onmessage: ((event: WorkerMessageEvent) => void) | null
} = {
  postMessage: vi.fn(),
  onmessage: null,
}

async function loadWorkerCore(
  getImplementation: (format: string) => {
    create: (options?: unknown) => ChunkedEncoder
  }
): Promise<{
  dispatch: (data: unknown) => void
  get: ReturnType<typeof vi.fn>
}> {
  vi.resetModules()
  selfStub.postMessage.mockReset()
  selfStub.onmessage = null
  vi.stubGlobal("self", selfStub)

  const get = vi.fn(getImplementation)
  vi.doMock("@/plugins/streaming-export/registry", () => ({
    defaultChunkedEncoderRegistry: { get },
  }))

  await import("@/workers/chunked-encoder-worker-core")

  return {
    dispatch(data: unknown) {
      selfStub.onmessage?.({ data })
    },
    get,
  }
}

beforeEach(() => {
  selfStub.postMessage.mockReset()
  selfStub.onmessage = null
})

afterEach(() => {
  vi.doUnmock("@/plugins/streaming-export/registry")
  vi.unstubAllGlobals()
})

describe("chunked-encoder-worker-core", () => {
  it("reports an init error when the encoder definition cannot be resolved", async () => {
    const { dispatch } = await loadWorkerCore(() => {
      throw "missing encoder"
    })

    dispatch({ type: "init", format: "missing" })

    expect(selfStub.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "missing encoder",
      seqId: -1,
    })
  })

  it("returns an error when feedFrame arrives before init", async () => {
    const { dispatch } = await loadWorkerCore(() => ({
      create: () => {
        throw new Error("should not be called")
      },
    }))

    dispatch({
      type: "feedFrame",
      planar: [new Int16Array([1])],
      channels: 1,
      sampleRate: 16000,
      seqId: 3,
    })

    expect(selfStub.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "ChunkedEncoder not initialized. Send an 'init' message first.",
      seqId: 3,
    })
  })

  it("initializes the encoder and posts copied frame results with transferables", async () => {
    const frameResult = new Uint8Array([1, 2, 3])
    const encoder: ChunkedEncoder = {
      feedFrame: vi.fn(() => frameResult),
      flush: vi.fn(() => null),
      dispose: vi.fn(),
    }
    const create = vi.fn(() => encoder)

    const { dispatch, get } = await loadWorkerCore(() => ({ create }))

    dispatch({ type: "init", format: "pcm", options: { bitsPerSample: 8 } })
    dispatch({
      type: "feedFrame",
      planar: [new Int16Array([9, 10])],
      channels: 1,
      sampleRate: 22050,
      seqId: 7,
    })

    expect(get).toHaveBeenCalledWith("pcm")
    expect(create).toHaveBeenCalledWith({ bitsPerSample: 8 })
    expect(encoder.feedFrame).toHaveBeenCalledWith(1, 22050, [
      new Int16Array([9, 10]),
    ])

    const [message, transfer] = selfStub.postMessage.mock.calls.at(-1)!
    expect(message).toEqual({
      type: "result",
      result: new Uint8Array([1, 2, 3]),
      seqId: 7,
    })
    expect(message.result).not.toBe(frameResult)
    expect(transfer).toEqual([message.result.buffer])
  })

  it("returns null frame results without a transfer list", async () => {
    const encoder: ChunkedEncoder = {
      feedFrame: vi.fn(() => null),
      flush: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const { dispatch } = await loadWorkerCore(() => ({
      create: () => encoder,
    }))

    dispatch({ type: "init", format: "pcm" })
    dispatch({
      type: "feedFrame",
      planar: [new Int16Array([1])],
      channels: 1,
      sampleRate: 16000,
      seqId: 8,
    })

    expect(selfStub.postMessage).toHaveBeenLastCalledWith({
      type: "result",
      result: null,
      seqId: 8,
    })
  })

  it("returns encoder errors from feedFrame and flush", async () => {
    const encoder: ChunkedEncoder = {
      feedFrame: () => {
        throw new Error("feed failed")
      },
      flush: () => {
        throw "flush failed"
      },
      dispose: vi.fn(),
    }

    const { dispatch } = await loadWorkerCore(() => ({
      create: () => encoder,
    }))

    dispatch({ type: "init", format: "pcm" })
    dispatch({
      type: "feedFrame",
      planar: [new Int16Array([1])],
      channels: 1,
      sampleRate: 16000,
      seqId: 11,
    })
    dispatch({ type: "flush", seqId: 12 })

    expect(selfStub.postMessage).toHaveBeenNthCalledWith(1, {
      type: "error",
      message: "feed failed",
      seqId: 11,
    })
    expect(selfStub.postMessage).toHaveBeenNthCalledWith(2, {
      type: "error",
      message: "flush failed",
      seqId: 12,
    })
  })

  it("stringifies non-Error failures from init, feedFrame and flush", async () => {
    const encoder: ChunkedEncoder = {
      feedFrame: () => {
        throw "feed string failure"
      },
      flush: () => {
        throw "flush string failure"
      },
      dispose: vi.fn(),
    }

    const { dispatch } = await loadWorkerCore((format) => {
      if (format === "broken-init") {
        throw "init string failure"
      }

      return { create: () => encoder }
    })

    dispatch({ type: "init", format: "broken-init" })
    dispatch({ type: "init", format: "pcm" })
    dispatch({
      type: "feedFrame",
      planar: [new Int16Array([1])],
      channels: 1,
      sampleRate: 16000,
      seqId: 41,
    })
    dispatch({ type: "flush", seqId: 42 })

    expect(selfStub.postMessage).toHaveBeenNthCalledWith(1, {
      type: "error",
      message: "init string failure",
      seqId: -1,
    })
    expect(selfStub.postMessage).toHaveBeenNthCalledWith(2, {
      type: "error",
      message: "feed string failure",
      seqId: 41,
    })
    expect(selfStub.postMessage).toHaveBeenNthCalledWith(3, {
      type: "error",
      message: "flush string failure",
      seqId: 42,
    })
  })

  it("flushes copied buffers and resets the encoder on dispose", async () => {
    const flushResult = new Uint8Array([4, 5])
    const encoder: ChunkedEncoder = {
      feedFrame: vi.fn(() => null),
      flush: vi.fn(() => flushResult),
      dispose: vi.fn(),
    }

    const { dispatch } = await loadWorkerCore(() => ({
      create: () => encoder,
    }))

    dispatch({ type: "init", format: "wav" })
    dispatch({ type: "flush", seqId: 21 })

    const [message, transfer] = selfStub.postMessage.mock.calls.at(-1)!
    expect(message).toEqual({
      type: "result",
      result: new Uint8Array([4, 5]),
      seqId: 21,
    })
    expect(message.result).not.toBe(flushResult)
    expect(transfer).toEqual([message.result.buffer])

    dispatch({ type: "dispose" })
    expect(encoder.dispose).toHaveBeenCalledTimes(1)

    selfStub.postMessage.mockClear()
    dispatch({ type: "flush", seqId: 22 })
    expect(selfStub.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "ChunkedEncoder not initialized.",
      seqId: 22,
    })
  })

  it("ignores dispose before initialization and still reports later flush errors", async () => {
    const { dispatch } = await loadWorkerCore(() => ({
      create: () => ({
        feedFrame: () => null,
        flush: () => null,
        dispose: vi.fn(),
      }),
    }))

    dispatch({ type: "dispose" })
    expect(selfStub.postMessage).not.toHaveBeenCalled()

    dispatch({ type: "flush", seqId: 30 })
    expect(selfStub.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "ChunkedEncoder not initialized.",
      seqId: 30,
    })
  })

  it("ignores unknown worker messages", async () => {
    const { dispatch } = await loadWorkerCore(() => ({
      create: () => ({
        feedFrame: () => null,
        flush: () => null,
        dispose: vi.fn(),
      }),
    }))

    dispatch({ type: "unknown" } as { type: string })

    expect(selfStub.postMessage).not.toHaveBeenCalled()
  })
})
