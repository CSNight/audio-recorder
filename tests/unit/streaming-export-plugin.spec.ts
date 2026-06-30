import { afterEach, describe, expect, it, vi } from "vitest"
import { RecorderController } from "@/core/recorder-controller"
import { createStreamingExportPlugin } from "@/plugins/streaming-export/plugin"
import type {
  StreamEncoderDefinition,
  StreamingExportFormat,
  StreamingPacketPayload,
} from "@/plugins/streaming-export/types"
import type { RecorderPluginEventContext } from "@/plugins/types"
import type {
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputSession,
  InputSessionSummary,
} from "@/input/types"
import { createAudioFrame } from "@/utils/audio-frame"

class FakeStreamingInputSession implements RecorderInputSession {
  constructor(
    private readonly handlers: RecorderInputHandlers,
    public readonly actualSampleRate = 16_000,
    public readonly actualChannelCount = 1 as const,
    public readonly actualInputStrategy = "audio-worklet" as const
  ) {}

  async start(): Promise<void> {}

  pause(): void {}

  async resume(): Promise<void> {}

  async stop(): Promise<InputSessionSummary> {
    return { frames: 1, durationMs: 10 }
  }

  async close(): Promise<void> {}

  emitFrame(samples: number[] = [0, 0.5, -0.5]): void {
    this.handlers.onFrame(
      createAudioFrame([new Float32Array(samples)], 16_000, 10)
    )
  }
}

class FakeStreamingInputAdapter implements RecorderInputAdapter {
  session: FakeStreamingInputSession | undefined

  async open(
    _request: Parameters<RecorderInputAdapter["open"]>[0],
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession> {
    this.session = new FakeStreamingInputSession(handlers)
    return this.session
  }
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
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function flushMicrotasks(times = 3): Promise<void> {
  for (let index = 0; index < times; index++) {
    await Promise.resolve()
  }
}

function isStreamingPacketEvent(
  event: unknown
): event is RecorderPluginEventContext<StreamingPacketPayload> {
  if (typeof event !== "object" || event === null) {
    return false
  }

  if (!("pluginName" in event) || !("payload" in event)) {
    return false
  }

  const { payload } = event as { payload: unknown }
  return (
    typeof payload === "object" &&
    payload !== null &&
    "chunk" in payload &&
    "isFinal" in payload &&
    "sequenceIndex" in payload &&
    "timestampMs" in payload &&
    "durationMs" in payload &&
    "sessionId" in payload
  )
}

describe("createStreamingExportPlugin", () => {
  it("throws when format is outside pcm/wav", () => {
    expect(() =>
      createStreamingExportPlugin({
        format: "test" as unknown as StreamingExportFormat,
        encoders: [],
      })
    ).toThrow(/only supports "pcm" and "wav"/)
  })

  it("throws when no encoder definition matches the requested supported format", () => {
    expect(() =>
      createStreamingExportPlugin({ format: "pcm", encoders: [] })
    ).toThrow(/ChunkedEncoder for format "pcm" not found/)
  })

  it("emits PCM stream packets through the recorder plugin event channel", async () => {
    const adapter = new FakeStreamingInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const events: Array<{
      sequenceIndex: number
      isFinal: boolean
      chunk: number[]
      timestampMs: number
      durationMs: number
      sessionId: string
      pluginName: string
    }> = []

    const definition: StreamEncoderDefinition = {
      format: "pcm",
      create: () => ({
        feedFrame: (_channels, _sampleRate, planar) =>
          new Uint8Array([
            planar[0]?.length ?? 0,
            (planar[0]?.[1] ?? 0) & 0xff,
          ]),
        flush: () => new Uint8Array([255]),
        dispose: () => undefined,
      }),
    }

    recorder.on("plugin:stream", (event) => {
      if (!isStreamingPacketEvent(event)) {
        throw new Error("Expected streaming packet plugin event.")
      }

      const { payload, pluginName } = event
      events.push({
        sequenceIndex: payload.sequenceIndex,
        isFinal: payload.isFinal,
        chunk: Array.from(payload.chunk),
        timestampMs: payload.timestampMs,
        durationMs: payload.durationMs,
        sessionId: payload.sessionId,
        pluginName,
      })
    })

    await recorder.use(
      createStreamingExportPlugin({ format: "pcm", encoders: [definition] })
    )
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame([0, 0.5, -0.5, 0.25])
    await flushMicrotasks()
    await recorder.stop()
    await flushMicrotasks()

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({
      sequenceIndex: 0,
      isFinal: false,
      chunk: [4, 0],
      timestampMs: 10,
      durationMs: 0.25,
      sessionId: events[0]?.sessionId,
      pluginName: "streaming-export:pcm",
    })
    expect(events[1]?.sequenceIndex).toBe(1)
    expect(events[1]?.isFinal).toBe(true)
    expect(events[1]?.chunk).toEqual([255])
    expect(events[1]?.durationMs).toBe(0)
    expect(events[1]?.sessionId).toBe(events[0]?.sessionId)
    expect(events[1]?.pluginName).toBe("streaming-export:pcm")
  })

  it("reuses the same worker across reopen and ignores stale PCM session chunks", async () => {
    vi.stubGlobal("Worker", class {})

    const adapter = new FakeStreamingInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const worker = new FakeWorker()
    const emitted: number[][] = []

    const definition: StreamEncoderDefinition = {
      format: "pcm",
      workerFactory: () => worker as unknown as Worker,
      create: () => ({
        feedFrame: () => new Uint8Array([99]),
        flush: () => null,
        dispose: () => undefined,
      }),
    }

    recorder.on("plugin:stream", (event) => {
      if (!isStreamingPacketEvent(event)) {
        throw new Error("Expected streaming packet plugin event.")
      }

      emitted.push(Array.from(event.payload.chunk))
    })

    await recorder.use(
      createStreamingExportPlugin({ format: "pcm", encoders: [definition] })
    )
    await recorder.open()
    await recorder.start()
    worker.emitMessage({ type: "ready" })
    adapter.session?.emitFrame()
    await flushMicrotasks()
    await recorder.stop()
    await recorder.close()

    await recorder.open()
    await recorder.start()
    worker.emitMessage({ type: "ready" })
    adapter.session?.emitFrame([0.25, -0.25])
    await flushMicrotasks()

    expect(worker.messages).toEqual([
      { type: "init", format: "pcm", options: undefined },
      { type: "reset", options: undefined },
      {
        type: "feedFrame",
        planar: [new Int16Array([0, 16384, -16384])],
        channels: 1,
        sampleRate: 16000,
        seqId: 0,
      },
      { type: "flush", seqId: 1 },
      { type: "reset", options: undefined },
      {
        type: "feedFrame",
        planar: [new Int16Array([8192, -8192])],
        channels: 1,
        sampleRate: 16000,
        seqId: 2,
      },
    ])

    worker.emitMessage({
      type: "result",
      result: new Uint8Array([2]),
      seqId: 2,
    })
    await flushMicrotasks()

    worker.emitMessage({
      type: "result",
      result: new Uint8Array([1]),
      seqId: 0,
    })
    await flushMicrotasks()

    expect(emitted).toEqual([[2]])
  })

  it("stops emitting after dispose even if an in-flight WAV worker encode resolves later", async () => {
    vi.stubGlobal("Worker", class {})

    const adapter = new FakeStreamingInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const emitted: number[][] = []
    const worker = new FakeWorker()

    const definition: StreamEncoderDefinition = {
      format: "wav",
      workerFactory: () => worker as unknown as Worker,
      create: () => ({
        feedFrame: () => new Uint8Array([7]),
        flush: () => null,
        dispose: () => undefined,
      }),
    }

    recorder.on("plugin:stream", (event) => {
      if (!isStreamingPacketEvent(event)) {
        throw new Error("Expected streaming packet plugin event.")
      }

      emitted.push(Array.from(event.payload.chunk))
    })

    await recorder.use(
      createStreamingExportPlugin({ format: "wav", encoders: [definition] })
    )
    await recorder.open()
    await recorder.start()
    worker.emitMessage({ type: "ready" })
    adapter.session?.emitFrame()
    await flushMicrotasks()
    await recorder.destroy()

    worker.emitMessage({
      type: "result",
      result: new Uint8Array([9]),
      seqId: 0,
    })
    await flushMicrotasks()

    expect(emitted).toEqual([])
    expect(worker.terminated).toBe(true)
  })

  it("does not emit frame chunks while paused and ignores null flush results", async () => {
    const adapter = new FakeStreamingInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const events: Array<{ isFinal: boolean; chunk: number[] }> = []

    const definition: StreamEncoderDefinition = {
      format: "wav",
      create: () => ({
        feedFrame: () => new Uint8Array([1]),
        flush: () => null,
        dispose: () => undefined,
      }),
    }

    recorder.on("plugin:stream", (event) => {
      if (!isStreamingPacketEvent(event)) {
        throw new Error("Expected streaming packet plugin event.")
      }

      events.push({
        isFinal: event.payload.isFinal,
        chunk: Array.from(event.payload.chunk),
      })
    })

    await recorder.use(
      createStreamingExportPlugin({ format: "wav", encoders: [definition] })
    )
    await recorder.open()
    await recorder.start()
    recorder.pause()
    adapter.session?.emitFrame()
    await recorder.resume()
    adapter.session?.emitFrame()
    await flushMicrotasks()
    await recorder.stop()
    await flushMicrotasks()

    expect(events).toEqual([{ isFinal: false, chunk: [1] }])
  })

  it("swallows worker rejections instead of surfacing unhandled plugin errors", async () => {
    vi.stubGlobal("Worker", class {})

    const adapter = new FakeStreamingInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const issues: string[] = []
    const worker = new FakeWorker()

    const definition: StreamEncoderDefinition = {
      format: "pcm",
      workerFactory: () => worker as unknown as Worker,
      create: () => ({
        feedFrame: () => new Uint8Array([7]),
        flush: () => null,
        dispose: () => undefined,
      }),
    }

    recorder.on("issue", ({ issue }) => {
      if (issue.kind === "error") {
        issues.push(issue.error.message)
      }
    })

    await recorder.use(
      createStreamingExportPlugin({ format: "pcm", encoders: [definition] })
    )
    await recorder.open()
    await recorder.start()
    worker.emitMessage({ type: "ready" })
    adapter.session?.emitFrame()
    await flushMicrotasks()

    worker.emitMessage({ type: "error", message: "worker failed", seqId: 0 })
    await flushMicrotasks()

    expect(issues).toEqual([])
  })
})
