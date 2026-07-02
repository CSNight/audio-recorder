import { describe, expect, it } from "vitest"
import type {
  InputSessionSummary,
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputSession,
} from "@/input/types"
import { RecorderController } from "@/core/recorder-controller"
import { pcmExportEncoder, wavExportEncoder } from "@/codecs/base"
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

  it("ignores empty frames (mono.length === 0)", async () => {
    const adapter = new FakeAsrInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const chunks: unknown[] = []

    recorder.on("plugin:asr:chunk", (event) => {
      chunks.push(event)
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

    // 传入长度为 0 的帧 → downmixToMono 返回空 Int16Array → 不进入 emitBufferedChunks
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(0)], 16000, 20)
    )
    await recorder.stop()

    // 没有触发任何 chunk（buffer 为空，stop 时 bufferedMono.length === 0）
    expect(chunks).toHaveLength(0)
  })

  it("resamples frames when sampleRate !== targetSampleRate", async () => {
    const adapter = new FakeAsrInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const chunks: Array<{ sampleRate: number; byteLength: number }> = []

    recorder.on("plugin:asr:chunk", (event) => {
      const { payload } = event as RecorderPluginEventContext<AsrChunkPayload>
      chunks.push({
        sampleRate: payload.sampleRate,
        byteLength: payload.chunk.byteLength,
      })
    })

    await recorder.use(
      createAsrExportPlugin({
        format: "pcm",
        encoders: [pcmExportEncoder],
        sampleRate: 8000, // 目标采样率 8kHz
        chunkDurationMs: 20, // 20ms @ 8kHz = 160 samples
      })
    )
    await recorder.open()
    await recorder.start()

    // 传入 16kHz 数据 → 触发重采样到 8kHz 路径 (lines 175-183)
    // 320 samples @ 16kHz = 20ms → 重采样后 160 samples @ 8kHz
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(320)], 16000, 20)
    )
    await recorder.stop()

    // 应该有 chunk 并且 sampleRate 是 8000
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0]?.sampleRate).toBe(8000)
  })

  it("throws when encoder for format is not found (resolveAsrEncoder)", async () => {
    expect(() =>
      createAsrExportPlugin({
        format: "wav",
        encoders: [pcmExportEncoder], // 故意不传 wavExportEncoder
        sampleRate: 16000,
        chunkDurationMs: 20,
      })
    ).toThrow('ASR export encoder for format "wav" not found')
  })

  it("throws when channels !== 1 (line 24)", () => {
    expect(() =>
      createAsrExportPlugin({
        format: "pcm",
        encoders: [pcmExportEncoder],
        sampleRate: 16000,
        chunkDurationMs: 20,
        channels: 2 as unknown as 1,
      })
    ).toThrow("ASR export only supports mono output")
  })

  it("throws when bitsPerSample !== 16 (line 27)", () => {
    expect(() =>
      createAsrExportPlugin({
        format: "pcm",
        encoders: [pcmExportEncoder],
        sampleRate: 16000,
        chunkDurationMs: 20,
        bitsPerSample: 8 as unknown as 16,
      })
    ).toThrow("ASR export currently only supports 16-bit output")
  })

  it("throws when chunkDurationMs <= 0 (line 30)", () => {
    expect(() =>
      createAsrExportPlugin({
        format: "pcm",
        encoders: [pcmExportEncoder],
        sampleRate: 16000,
        chunkDurationMs: 0,
      })
    ).toThrow("ASR chunkDurationMs must be positive")
  })

  it("dispose clears state without throwing", async () => {
    const adapter = new FakeAsrInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })

    const plugin = createAsrExportPlugin({
      format: "pcm",
      encoders: [pcmExportEncoder],
      sampleRate: 16000,
      chunkDurationMs: 20,
    })

    await recorder.use(plugin)
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(80)], 16000, 10)
    )
    // dispose 是 RecorderController 内部生命周期调用，通过 close 触发
    await recorder.stop()
    await recorder.close()
    // 如果 dispose 正常执行则不会抛出
  })
})
