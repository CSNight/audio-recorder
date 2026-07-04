import { describe, expect, it } from "vitest"
import type {
  AudioFrame,
  StreamEncoderDefinition,
  StreamingPacketPayload,
} from "../../src"
import { RecorderController } from "../../src"
import { pcmExportEncoder, wavStreamEncoder } from "../../src/codecs/base"
import { createSonicExportPlugin } from "../../src/plugins/sonic-export"
import { createStreamingExportPlugin } from "../../src/plugins/streaming-export"
import type { RecorderPluginEventContext } from "../../src/plugins/types"
import type {
  InputSessionSummary,
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputSession,
} from "../../src/input/types"
import { createAudioFrame } from "../../src/utils/audio-frame"

class FakeSonicInputSession implements RecorderInputSession {
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
    return { frames: 1, durationMs: 100 }
  }

  async close(): Promise<void> {}

  emitFrame(frame: AudioFrame): void {
    this.handlers.onFrame(frame)
  }
}

class FakeSonicInputAdapter implements RecorderInputAdapter {
  session: FakeSonicInputSession | undefined

  async open(
    _request: Parameters<RecorderInputAdapter["open"]>[0],
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession> {
    this.session = new FakeSonicInputSession(handlers)
    return this.session
  }
}

function createMonoFrame(frameLength = 1600, timestamp = 10): AudioFrame {
  const samples = new Float32Array(frameLength)
  for (let index = 0; index < frameLength; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * index) / 40)
  }
  return createAudioFrame([samples], 16_000, timestamp)
}

function createStereoFrame(frameLength = 1600, timestamp = 10): AudioFrame {
  const left = new Float32Array(frameLength)
  const right = new Float32Array(frameLength)
  for (let index = 0; index < frameLength; index += 1) {
    left[index] = Math.sin((2 * Math.PI * index) / 40)
    right[index] = Math.cos((2 * Math.PI * index) / 32)
  }
  return createAudioFrame([left, right], 16_000, timestamp)
}

function isStreamingPacketEvent(
  event: unknown
): event is RecorderPluginEventContext<StreamingPacketPayload> {
  if (typeof event !== "object" || event === null) {
    return false
  }

  return "pluginName" in event && "payload" in event
}

async function flushMicrotasks(times = 6): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve()
  }
}

describe("createSonicExportPlugin", () => {
  it("emits transformed plugin:stream packets while keeping the recorder PCM export untouched", async () => {
    const adapter = new FakeSonicInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
      encoders: [pcmExportEncoder],
    })
    const frame = createMonoFrame()
    const events: StreamingPacketPayload[] = []

    const definition: StreamEncoderDefinition = {
      format: "pcm",
      create: () => ({
        feedFrame: (_channels, _sampleRate, planar) => {
          const sampleCount = planar[0]?.length ?? 0
          return new Uint8Array([sampleCount & 0xff, (sampleCount >> 8) & 0xff])
        },
        flush: () => new Uint8Array([255]),
        dispose: () => undefined,
      }),
    }

    recorder.on("plugin:stream", (event) => {
      if (!isStreamingPacketEvent(event)) {
        throw new Error("Expected streaming packet event.")
      }
      events.push(event.payload)
    })

    const plugin = createSonicExportPlugin({
      format: "pcm",
      encoders: [definition],
      speed: 2,
      blockMs: 100,
    })

    await recorder.use(plugin)
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame(frame)
    await flushMicrotasks()
    await recorder.stop()
    await flushMicrotasks()

    const rawPcm = await recorder.exportEncoded("pcm")
    expect(rawPcm.data.length).toBe(frame.planar[0]?.length ?? 0)

    expect(events).toHaveLength(2)
    expect(events[0]?.format).toBe("pcm")
    expect(events[0]?.isFinal).toBe(false)
    expect(events[0]?.chunk).toEqual(new Uint8Array([32, 3]))
    expect(events[1]?.isFinal).toBe(true)
    expect(events[1]?.chunk).toEqual(new Uint8Array([255]))
  })

  it("supports stereo sonic processing and wav stream encoding", async () => {
    const adapter = new FakeSonicInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
      encoders: [pcmExportEncoder],
    })
    const frame = createStereoFrame()
    const events: StreamingPacketPayload[] = []

    recorder.on("plugin:stream", (event) => {
      if (!isStreamingPacketEvent(event)) {
        throw new Error("Expected streaming packet event.")
      }
      events.push(event.payload)
    })

    await recorder.use(
      createSonicExportPlugin({
        format: "wav",
        encoders: [wavStreamEncoder],
        encoderOptions: { framesPerChunk: 1 },
        speed: 1.5,
        blockMs: 100,
      })
    )
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame(frame)
    await flushMicrotasks()
    await recorder.stop()
    await flushMicrotasks()

    expect(events.length).toBeGreaterThan(0)
    expect(events[0]?.format).toBe("wav")
    expect(events[0]?.channels).toBe(2)
    expect(events[0]?.chunk.byteLength).toBeGreaterThan(44)
  })

  it("rejects coexistence with streaming-export because both publish plugin:stream", async () => {
    const adapter = new FakeSonicInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const definition: StreamEncoderDefinition = {
      format: "pcm",
      create: () => ({
        feedFrame: () => new Uint8Array([1]),
        flush: () => null,
        dispose: () => undefined,
      }),
    }

    await recorder.use(
      createStreamingExportPlugin({ format: "pcm", encoders: [definition] })
    )

    await expect(
      recorder.use(
        createSonicExportPlugin({
          format: "pcm",
          encoders: [definition],
        })
      )
    ).rejects.toThrow(
      'Recorder plugin "sonic-export:pcm" conflicts with "streaming-export:pcm".'
    )
  })

  it("transforms snapshots offline with the requested speed", async () => {
    const plugin = createSonicExportPlugin({
      format: "pcm",
      encoders: [
        {
          format: "pcm",
          create: () => ({
            feedFrame: () => null,
            flush: () => null,
            dispose: () => undefined,
          }),
        },
      ],
    })
    const snapshot = {
      sampleRate: 16_000,
      channels: 1,
      frameCount: 3200,
      durationMs: 200,
      planar: [
        new Int16Array(3200).map((_, index) =>
          index % 2 === 0 ? 1000 : -1000
        ),
      ],
    }

    const slower = await plugin.transformSnapshot(snapshot, { speed: 0.5 })
    const mono = await plugin.transform(
      snapshot.planar[0]!,
      snapshot.sampleRate,
      { speed: 2 }
    )
    const stereoSnapshot = {
      ...snapshot,
      channels: 2 as const,
      planar: [
        snapshot.planar[0]!,
        new Int16Array(snapshot.planar[0]!).map((sample) => -sample),
      ],
    }
    const stereo = await plugin.transform(
      interleaveStereo(stereoSnapshot.planar[0]!, stereoSnapshot.planar[1]!),
      stereoSnapshot.sampleRate,
      2,
      { speed: 2 }
    )

    expect(slower.length).toBe(6400)
    expect(mono.length).toBe(1600)
    expect(stereo.length).toBe(3200)
  })
})

function interleaveStereo(left: Int16Array, right: Int16Array): Int16Array {
  const output = new Int16Array(left.length * 2)
  for (let index = 0; index < left.length; index += 1) {
    output[index * 2] = left[index] ?? 0
    output[index * 2 + 1] = right[index] ?? 0
  }

  return output
}
