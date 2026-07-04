import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { StreamEncoder, StreamEncoderDefinition } from "../../src"
import { createWorkerMessageHandler } from "../../src/workers/chunked-encoder-worker-core"

const postMessage = vi.fn()

beforeEach(() => {
  postMessage.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function buildHandler(
  resolveDefinition: (format: string) => StreamEncoderDefinition
): (data: unknown) => Promise<void> {
  const handler = createWorkerMessageHandler(resolveDefinition)
  return async (data: unknown) => {
    await handler({ data } as MessageEvent<any>)
  }
}

function definitionFor(create: (options?: unknown) => StreamEncoder) {
  return { format: "pcm", create } as StreamEncoderDefinition
}

describe("createWorkerMessageHandler", () => {
  it("reports an init error when the encoder definition cannot be resolved", async () => {
    vi.stubGlobal("self", { postMessage })

    const dispatch = buildHandler(() => {
      throw "missing encoder"
    })

    await dispatch({ type: "init", format: "missing" })

    expect(postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "missing encoder",
      seqId: -1,
    })
  })

  it("returns an error when feedFrame arrives before init", async () => {
    vi.stubGlobal("self", { postMessage })

    const dispatch = buildHandler(() =>
      definitionFor(() => {
        throw new Error("should not be called")
      })
    )

    await dispatch({
      type: "feedFrame",
      planar: [new Int16Array([1])],
      channels: 1,
      sampleRate: 16000,
      seqId: 3,
    })

    expect(postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "ChunkedEncoder not initialized. Send an 'init' message first.",
      seqId: 3,
    })
  })

  it("initializes the encoder and posts copied frame results with transferables", async () => {
    vi.stubGlobal("self", { postMessage })

    const frameResult = new Uint8Array([1, 2, 3])
    const encoder: StreamEncoder = {
      feedFrame: vi.fn(() => frameResult),
      flush: vi.fn(() => null),
      dispose: vi.fn(),
    }
    const create = vi.fn(() => encoder)
    const resolveDefinition = vi.fn(() => definitionFor(create))

    const dispatch = buildHandler(resolveDefinition)

    await dispatch({
      type: "init",
      format: "pcm",
      options: { bitsPerSample: 8 },
    })
    await dispatch({
      type: "feedFrame",
      planar: [new Int16Array([9, 10])],
      channels: 1,
      sampleRate: 22050,
      seqId: 7,
    })

    expect(resolveDefinition).toHaveBeenCalledWith("pcm")
    expect(create).toHaveBeenCalledWith({ bitsPerSample: 8 })
    expect(encoder.feedFrame).toHaveBeenCalledWith(1, 22050, [
      new Int16Array([9, 10]),
    ])
    expect(postMessage).toHaveBeenNthCalledWith(1, { type: "ready" })

    const [message, transfer] = postMessage.mock.calls.at(-1)!
    expect(message).toEqual({
      type: "result",
      result: new Uint8Array([1, 2, 3]),
      seqId: 7,
    })
    expect(message.result).not.toBe(frameResult)
    expect(transfer).toEqual([message.result.buffer])
  })

  it("returns null frame results without a transfer list", async () => {
    vi.stubGlobal("self", { postMessage })

    const encoder: StreamEncoder = {
      feedFrame: vi.fn(() => null),
      flush: vi.fn(() => null),
      dispose: vi.fn(),
    }

    const dispatch = buildHandler(() => definitionFor(() => encoder))

    await dispatch({ type: "init", format: "pcm" })
    await dispatch({
      type: "feedFrame",
      planar: [new Int16Array([1])],
      channels: 1,
      sampleRate: 16000,
      seqId: 8,
    })

    expect(postMessage).toHaveBeenLastCalledWith({
      type: "result",
      result: null,
      seqId: 8,
    })
  })

  it("returns encoder errors from feedFrame and flush", async () => {
    vi.stubGlobal("self", { postMessage })

    const encoder: StreamEncoder = {
      feedFrame: () => {
        throw new Error("feed failed")
      },
      flush: () => {
        throw "flush failed"
      },
      dispose: vi.fn(),
    }

    const dispatch = buildHandler(() => definitionFor(() => encoder))

    await dispatch({ type: "init", format: "pcm" })
    await dispatch({
      type: "feedFrame",
      planar: [new Int16Array([1])],
      channels: 1,
      sampleRate: 16000,
      seqId: 11,
    })
    await dispatch({ type: "flush", seqId: 12 })

    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: "error",
      message: "feed failed",
      seqId: 11,
    })
    expect(postMessage).toHaveBeenNthCalledWith(3, {
      type: "error",
      message: "flush failed",
      seqId: 12,
    })
  })

  it("stringifies non-Error failures from init, feedFrame and flush", async () => {
    vi.stubGlobal("self", { postMessage })

    const encoder: StreamEncoder = {
      feedFrame: () => {
        throw "feed string failure"
      },
      flush: () => {
        throw "flush string failure"
      },
      dispose: vi.fn(),
    }

    const dispatch = buildHandler((format) => {
      if (format === "broken-init") {
        throw "init string failure"
      }

      return definitionFor(() => encoder)
    })

    await dispatch({ type: "init", format: "broken-init" })
    await dispatch({ type: "init", format: "pcm" })
    await dispatch({
      type: "feedFrame",
      planar: [new Int16Array([1])],
      channels: 1,
      sampleRate: 16000,
      seqId: 41,
    })
    await dispatch({ type: "flush", seqId: 42 })

    expect(postMessage).toHaveBeenNthCalledWith(1, {
      type: "error",
      message: "init string failure",
      seqId: -1,
    })
    expect(postMessage).toHaveBeenNthCalledWith(3, {
      type: "error",
      message: "feed string failure",
      seqId: 41,
    })
    expect(postMessage).toHaveBeenNthCalledWith(4, {
      type: "error",
      message: "flush string failure",
      seqId: 42,
    })
  })

  it("flushes copied buffers and resets the encoder on dispose", async () => {
    vi.stubGlobal("self", { postMessage })

    const flushResult = new Uint8Array([4, 5])
    const encoder: StreamEncoder = {
      feedFrame: vi.fn(() => null),
      flush: vi.fn(() => flushResult),
      dispose: vi.fn(),
    }

    const dispatch = buildHandler(() => definitionFor(() => encoder))

    await dispatch({ type: "init", format: "wav" })
    await dispatch({ type: "flush", seqId: 21 })

    const [message, transfer] = postMessage.mock.calls.at(-1)!
    expect(message).toEqual({
      type: "result",
      result: new Uint8Array([4, 5]),
      seqId: 21,
    })
    expect(message.result).not.toBe(flushResult)
    expect(transfer).toEqual([message.result.buffer])

    await dispatch({ type: "dispose" })
    expect(encoder.dispose).toHaveBeenCalledTimes(1)

    postMessage.mockClear()
    await dispatch({ type: "flush", seqId: 22 })
    expect(postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "ChunkedEncoder not initialized.",
      seqId: 22,
    })
  })

  it("recreates the encoder on reset with the same definition", async () => {
    vi.stubGlobal("self", { postMessage })

    const firstEncoder: StreamEncoder = {
      feedFrame: vi.fn(() => null),
      flush: vi.fn(() => null),
      dispose: vi.fn(),
    }
    const secondEncoder: StreamEncoder = {
      feedFrame: vi.fn(() => new Uint8Array([6])),
      flush: vi.fn(() => null),
      dispose: vi.fn(),
    }
    const create = vi
      .fn<(options?: unknown) => StreamEncoder>()
      .mockReturnValueOnce(firstEncoder)
      .mockReturnValueOnce(secondEncoder)
    const dispatch = buildHandler(() => definitionFor(create))

    await dispatch({ type: "init", format: "pcm", options: { quality: 1 } })
    await dispatch({ type: "reset", options: { quality: 2 } })
    await dispatch({
      type: "feedFrame",
      planar: [new Int16Array([5])],
      channels: 1,
      sampleRate: 16000,
      seqId: 99,
    })

    expect(firstEncoder.dispose).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenNthCalledWith(1, { quality: 1 })
    expect(create).toHaveBeenNthCalledWith(2, { quality: 2 })
    expect(postMessage).toHaveBeenNthCalledWith(2, { type: "ready" })
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: "result",
        result: new Uint8Array([6]),
        seqId: 99,
      },
      [postMessage.mock.calls.at(-1)![0].result.buffer]
    )
  })

  it("ignores dispose before initialization and still reports later flush errors", async () => {
    vi.stubGlobal("self", { postMessage })

    const dispatch = buildHandler(() =>
      definitionFor(() => ({
        feedFrame: () => null,
        flush: () => null,
        dispose: vi.fn(),
      }))
    )

    await dispatch({ type: "dispose" })
    expect(postMessage).not.toHaveBeenCalled()

    await dispatch({ type: "flush", seqId: 30 })
    expect(postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "ChunkedEncoder not initialized.",
      seqId: 30,
    })
  })

  it("ignores unknown worker messages", async () => {
    vi.stubGlobal("self", { postMessage })

    const dispatch = buildHandler(() =>
      definitionFor(() => ({
        feedFrame: () => null,
        flush: () => null,
        dispose: vi.fn(),
      }))
    )

    await dispatch({ type: "unknown" } as { type: string })

    expect(postMessage).not.toHaveBeenCalled()
  })
})
