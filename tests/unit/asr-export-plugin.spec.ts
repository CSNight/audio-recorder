import { describe, expect, it } from "vitest"
import type {
  InputSessionSummary,
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputSession,
} from "@/input/types"
import { RecorderController } from "@/core/recorder-controller"
import {
  pcmExportEncoder,
  wavExportEncoder,
} from "@/codecs/base"
import { createAsrExportPlugin } from "@/plugins/asr-export"
import type { AsrChunkPayload } from "@/plugins/asr-export/types"
import type { RecorderPluginEventContext } from "@/plugins/types"
import { createAudioFrame } from "@/utils/audio-frame"

class FakeAsrInputSession implements RecorderInputSession {
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
    return { frames: 1, durationMs: 20 }
  }
  async close(): Promise<void> {}

  emitFrame(frame: ReturnType<typeof createAudioFrame>): void {
    this.handlers.onFrame(frame)
  }
}

class FakeAsrInputAdapter implements RecorderInputAdapter {
  session: FakeAsrInputSession | undefined

  async open(
    _request: Parameters<RecorderInputAdapter["open"]>[0],
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession> {
    this.session = new FakeAsrInputSession(handlers)
    return this.session
  }
}

describe("createAsrExportPlugin", () => {
  it("emits PCM ASR chunks with final flush on stop", async () => {
    const adapter = new FakeAsrInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const chunks: Array<{
      format: string
      isFinal: boolean
      byteLength: number
      sampleRate: number
      channels: number
    }> = []

    recorder.on("plugin:asr:chunk", (event) => {
      const { payload } = event as RecorderPluginEventContext<AsrChunkPayload>
      chunks.push({
        format: payload.format,
        isFinal: payload.isFinal,
        byteLength: payload.chunk.byteLength,
        sampleRate: payload.sampleRate,
        channels: payload.channels,
      })
    })

    await recorder.use(
      createAsrExportPlugin({
        format: "pcm",
        encoders: [pcmExportEncoder],
        sampleRate: 16000,
        chunkDurationMs: 20,
      })
    )
    await recorder.open()
    await recorder.start()

    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(160)], 16000, 10)
    )
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(160)], 16000, 20)
    )
    await recorder.stop()

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({
      format: "pcm",
      isFinal: false,
      byteLength: 640,
      sampleRate: 16000,
      channels: 1,
    })
  })

  it("downmixes stereo to mono and emits complete WAV chunks", async () => {
    const adapter = new FakeAsrInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const chunks: Uint8Array[] = []

    recorder.on("plugin:asr:chunk", (event) => {
      const { payload } = event as RecorderPluginEventContext<AsrChunkPayload>
      chunks.push(payload.chunk)
    })

    await recorder.use(
      createAsrExportPlugin({
        format: "wav",
        encoders: [wavExportEncoder],
        sampleRate: 16000,
        chunkDurationMs: 10,
      })
    )
    await recorder.open({ channelCount: 2 })
    await recorder.start()

    adapter.session?.emitFrame(
      createAudioFrame(
        [new Float32Array(160), new Float32Array(160).fill(0.5)],
        16000,
        10
      )
    )
    await recorder.stop()

    expect(chunks).toHaveLength(1)
    expect(Array.from(chunks[0]!.subarray(0, 4))).toEqual([
      0x52, 0x49, 0x46, 0x46,
    ])
  })

  it("stops emitting while paused and flushes final padded chunk on stop", async () => {
    const adapter = new FakeAsrInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const finals: boolean[] = []

    recorder.on("plugin:asr:chunk", (event) => {
      const { payload } = event as RecorderPluginEventContext<AsrChunkPayload>
      finals.push(payload.isFinal)
    })

    await recorder.use(
      createAsrExportPlugin({
        format: "pcm",
        encoders: [pcmExportEncoder],
        sampleRate: 16000,
        chunkDurationMs: 20,
      })
    )
    await recorder.open()
    await recorder.start()
    recorder.pause()
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(80)], 16000, 10)
    )
    await recorder.resume()
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(80)], 16000, 20)
    )
    await recorder.stop()

    expect(finals).toEqual([true])
  })
})
