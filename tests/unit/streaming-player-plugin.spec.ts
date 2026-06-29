import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  InputSessionSummary,
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputSession,
} from "@/input/types"
import { wavDecoderDefinition } from "@/codecs/base"
import { RecorderController } from "@/core/recorder-controller"
import { createStreamingPlayerPlugin } from "@/plugins/streaming-player"
import { createStreamingExportPlugin } from "@/plugins/streaming-export"
import { createAudioFrame } from "@/utils/audio-frame"
import type { ChunkedEncoderDefinition } from "@/plugins/streaming-export/types"

class FakePlayerInputSession implements RecorderInputSession {
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

  emitFrame(
    frame = createAudioFrame([new Float32Array([0, 0.5, -0.5])], 16000, 10)
  ) {
    this.handlers.onFrame(frame)
  }
}

class FakePlayerInputAdapter implements RecorderInputAdapter {
  session: FakePlayerInputSession | undefined

  async open(
    _request: Parameters<RecorderInputAdapter["open"]>[0],
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession> {
    this.session = new FakePlayerInputSession(handlers)
    return this.session
  }
}

class FakeBufferSource {
  buffer: AudioBuffer | null = null
  connect = vi.fn()
  start = vi.fn()
}

class FakeAudioBuffer {
  private readonly channels: Float32Array[]

  constructor(
    public readonly numberOfChannels: number,
    public readonly length: number,
    public readonly sampleRate: number
  ) {
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length)
    )
  }

  get duration() {
    return this.length / this.sampleRate
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!
  }
}

function createAudioContextStub() {
  const createdBuffers: FakeAudioBuffer[] = []
  const createdSources: FakeBufferSource[] = []

  const context = {
    state: "running",
    currentTime: 0,
    destination: {},
    createGain: () => ({
      gain: { value: 1 },
      connect: vi.fn(),
    }),
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      const buffer = new FakeAudioBuffer(channels, length, sampleRate)
      createdBuffers.push(buffer)
      return buffer as unknown as AudioBuffer
    },
    createBufferSource: () => {
      const source = new FakeBufferSource()
      createdSources.push(source)
      return source as unknown as AudioBufferSourceNode
    },
    resume: vi.fn(async () => undefined),
    suspend: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }

  return {
    context,
    createdBuffers,
    createdSources,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createStreamingPlayerPlugin", () => {
  it("plays recorder PCM frames through AudioContext", async () => {
    const adapter = new FakePlayerInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const audio = createAudioContextStub()

    vi.stubGlobal(
      "AudioContext",
      vi.fn(() => audio.context)
    )

    await recorder.use(createStreamingPlayerPlugin())
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame()

    expect(audio.createdBuffers).toHaveLength(1)
    expect(audio.createdSources).toHaveLength(1)
    expect(audio.createdSources[0]?.start).toHaveBeenCalledTimes(1)
  })

  it("consumes WAV chunks from plugin:encoded-chunk events", async () => {
    const adapter = new FakePlayerInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const audio = createAudioContextStub()

    vi.stubGlobal(
      "AudioContext",
      vi.fn(() => audio.context)
    )

    const definition: ChunkedEncoderDefinition = {
      format: "wav",
      create: () => ({
        feedFrame: () =>
          new Uint8Array([
            0x52, 0x49, 0x46, 0x46, 0x28, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56,
            0x45, 0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00,
            0x01, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x00, 0x7d, 0x00, 0x00, 0x02,
            0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, 0x04, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x40,
          ]),
        flush: () => null,
        dispose: () => undefined,
      }),
    }

    await recorder.use(
      createStreamingPlayerPlugin({
        source: {
          type: "plugin-event",
          event: "plugin:encoded-chunk",
          format: "wav",
          encoders: [wavDecoderDefinition],
        },
      })
    )
    await recorder.use(
      createStreamingExportPlugin({
        format: "wav",
        encoders: [definition],
      })
    )
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame()
    await Promise.resolve()

    expect(audio.createdBuffers).toHaveLength(1)
    expect(audio.createdBuffers[0]?.sampleRate).toBe(16000)
    expect(audio.createdSources).toHaveLength(1)
  })
})
