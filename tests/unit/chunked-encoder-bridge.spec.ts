import { afterEach, describe, expect, it, vi } from "vitest"
import { ChunkedEncoderBridge } from "@/workers/chunked-encoder-bridge"
import { ChunkedEncoderRegistry } from "@/plugins/streaming-export/registry"
import { pcmChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/pcm"
import { wavChunkedEncoderDefinition } from "@/plugins/streaming-export/encoders/wav"

/**
 * vitest 在 Node.js 下 typeof Worker === 'undefined'，
 * 所以 ChunkedEncoderBridge 自动回退到主线程同步模式。
 * 这些测试覆盖主线程 fallback 路径。
 */

function buildRegistry() {
  const registry = new ChunkedEncoderRegistry()
  registry.register(pcmChunkedEncoderDefinition)
  registry.register(wavChunkedEncoderDefinition)
  return registry
}

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

describe("ChunkedEncoderBridge (main-thread fallback)", () => {
  it("feedFrame returns PCM chunk synchronously via Promise", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "pcm",
      registry: buildRegistry(),
    })

    const result = await bridge.feedFrame(1, 16000, mono([100, 200]))
    expect(result).not.toBeNull()
    expect(result!.byteLength).toBe(4) // 2 samples × 2 bytes

    bridge.dispose()
  })

  it("flush returns null for PCM encoder (no buffer)", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "pcm",
      registry: buildRegistry(),
    })
    await bridge.feedFrame(1, 16000, mono([1, 2]))
    const result = await bridge.flush()
    expect(result).toBeNull()
    bridge.dispose()
  })

  it("WAV bridge accumulates frames and emits on flush", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "wav",
      encoderOptions: { framesPerChunk: 10 },
      registry: buildRegistry(),
    })

    // 不够 10 帧，feedFrame 应返回 null
    const mid = await bridge.feedFrame(1, 16000, mono([1, 2, 3]))
    expect(mid).toBeNull()

    // flush 返回剩余数据
    const final = await bridge.flush()
    expect(final).not.toBeNull()
    expect(final!.byteLength).toBeGreaterThan(44) // header + data

    bridge.dispose()
  })

  it("rejects feedFrame and flush after dispose", async () => {
    const bridge = new ChunkedEncoderBridge({
      format: "pcm",
      registry: buildRegistry(),
    })
    bridge.dispose()

    await expect(bridge.feedFrame(1, 16000, mono([1]))).rejects.toThrow(
      "disposed"
    )
    await expect(bridge.flush()).rejects.toThrow("disposed")
  })

  it("throws on unknown format", () => {
    expect(
      () =>
        new ChunkedEncoderBridge({ format: "ogg", registry: buildRegistry() })
    ).toThrow()
  })

  it("throws when allowMainThreadFallback is false and Worker is unavailable", () => {
    // vitest 运行在 Node 下，typeof Worker === 'undefined'，模拟 Worker 不可用
    expect(
      () =>
        new ChunkedEncoderBridge({
          format: "pcm",
          registry: buildRegistry(),
          allowMainThreadFallback: false,
        })
    ).toThrow("allowMainThreadFallback")
  })

  it("uses the worker path when a worker factory is available", async () => {
    vi.stubGlobal("Worker", class {})

    const worker = new FakeWorker()
    const registry = new ChunkedEncoderRegistry()
    registry.register({
      format: "custom",
      workerFactory: () => worker as unknown as Worker,
      create: vi.fn(() => {
        throw new Error("main-thread fallback should not be used")
      }),
    })

    const bridge = new ChunkedEncoderBridge({
      format: "custom",
      encoderOptions: { bitrate: 128 },
      registry,
    })

    expect(worker.messages[0]).toEqual({
      type: "init",
      format: "custom",
      options: { bitrate: 128 },
    })

    worker.emitMessage({ type: "result", result: null, seqId: 999 })

    const feedPromise = bridge.feedFrame(1, 16000, mono([1, 2]))
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
    const registry = new ChunkedEncoderRegistry()
    registry.register({
      format: "custom",
      workerFactory: () => worker as unknown as Worker,
      create: () => ({
        feedFrame: () => null,
        flush: () => null,
        dispose: () => undefined,
      }),
    })

    const bridge = new ChunkedEncoderBridge({ format: "custom", registry })

    const feedPromise = bridge.feedFrame(1, 16000, mono([1]))
    const flushPromise = bridge.flush()

    worker.emitError("worker blew up")

    await expect(feedPromise).rejects.toThrow("worker blew up")
    await expect(flushPromise).rejects.toThrow("worker blew up")
  })

  it("rejects pending worker operations when disposed and ignores repeated dispose", async () => {
    vi.stubGlobal("Worker", class {})

    const worker = new FakeWorker()
    const registry = new ChunkedEncoderRegistry()
    registry.register({
      format: "custom",
      workerFactory: () => worker as unknown as Worker,
      create: () => ({
        feedFrame: () => null,
        flush: () => null,
        dispose: () => undefined,
      }),
    })

    const bridge = new ChunkedEncoderBridge({ format: "custom", registry })
    const feedPromise = bridge.feedFrame(1, 16000, mono([9]))

    bridge.dispose()
    bridge.dispose()

    await expect(feedPromise).rejects.toThrow("ChunkedEncoderBridge disposed")
    expect(worker.terminated).toBe(true)
  })

  it("falls back to the main thread when worker construction fails", async () => {
    vi.stubGlobal("Worker", class {})

    const registry = new ChunkedEncoderRegistry()
    registry.register({
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
    })

    const bridge = new ChunkedEncoderBridge({ format: "custom", registry })
    const result = await bridge.feedFrame(1, 16000, mono([5, 6]))

    expect(result).toEqual(new Uint8Array([5, 0, 6, 0]))
  })

  it("converts main-thread encoder errors into rejected promises", async () => {
    const registry = new ChunkedEncoderRegistry()
    registry.register({
      format: "feed-error",
      create: () => ({
        feedFrame: () => {
          throw "feed failed"
        },
        flush: () => null,
        dispose: () => undefined,
      }),
    })
    registry.register({
      format: "flush-error",
      create: () => ({
        feedFrame: () => null,
        flush: () => {
          throw "flush failed"
        },
        dispose: () => undefined,
      }),
    })

    const feedBridge = new ChunkedEncoderBridge({
      format: "feed-error",
      registry,
    })
    const flushBridge = new ChunkedEncoderBridge({
      format: "flush-error",
      registry,
    })

    await expect(feedBridge.feedFrame(1, 16000, mono([1]))).rejects.toThrow(
      "feed failed"
    )
    await expect(flushBridge.flush()).rejects.toThrow("flush failed")
  })
})
