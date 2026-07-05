import { describe, expect, it } from "vitest"
import type {
  InputSessionSummary,
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputSession,
} from "../../src/input/types"
import { RecorderController } from "../../src"
import { createFrequencyHistogramPlugin } from "../../src/plugins/frequency-histogram"
import {
  analyzeFrequencyBars,
  resolveFrequencyHistogramOptions,
} from "../../src/plugins/frequency-histogram/fft"
import { createAudioFrame } from "../../src/utils/audio-frame"

class FakeFrequencyInputSession implements RecorderInputSession {
  constructor(
    private readonly handlers: RecorderInputHandlers,
    public readonly actualSampleRate = 16000,
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

class FakeFrequencyInputAdapter implements RecorderInputAdapter {
  session: FakeFrequencyInputSession | undefined

  async open(
    _request: Parameters<RecorderInputAdapter["open"]>[0],
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession> {
    this.session = new FakeFrequencyInputSession(handlers)
    return this.session
  }
}

describe("createFrequencyHistogramPlugin", () => {
  it("returns zero bars for silent or near-silent input and rejects non power-of-two fft sizes", () => {
    expect(() =>
      resolveFrequencyHistogramOptions({
        fftSize: 768 as 512,
      })
    ).toThrow("power of two")

    const bars = analyzeFrequencyBars(
      new Float32Array(512),
      16000,
      resolveFrequencyHistogramOptions({
        fftSize: 512,
        barCount: 12,
      })
    )
    const nearSilent = new Float32Array(512).map((_, index) =>
      index % 2 === 0 ? 0.0008 : -0.0008
    )
    const noiseBars = analyzeFrequencyBars(
      nearSilent,
      16000,
      resolveFrequencyHistogramOptions({
        fftSize: 512,
        barCount: 12,
      })
    )

    expect(Array.from(bars)).toEqual(new Array(12).fill(0))
    expect(Array.from(noiseBars)).toEqual(new Array(12).fill(0))
  })

  it("emits plugin:fft events with normalized bars", async () => {
    const adapter = new FakeFrequencyInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const events: Array<{
      bars: Float32Array
      sampleRate: number
      fftSize: number
    }> = []

    recorder.on("plugin:fft", ({ payload }) => {
      events.push(payload)
    })

    await recorder.use(
      createFrequencyHistogramPlugin({
        fftSize: 512,
        barCount: 16,
      })
    )
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame(createSineFrame(440, 16000, 512, 0))

    expect(events).toHaveLength(1)
    expect(events[0]?.bars).toHaveLength(16)
    expect(events[0]?.sampleRate).toBe(16000)
    expect(events[0]?.fftSize).toBe(512)
    expect(Math.max(...Array.from(events[0]!.bars))).toBeGreaterThan(0.1)
    expect(Math.max(...Array.from(events[0]!.bars))).toBeLessThanOrEqual(1)
  })

  it("respects pause/resume and frameInterval", async () => {
    const adapter = new FakeFrequencyInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const eventCount: number[] = []

    recorder.on("plugin:fft", () => {
      eventCount.push(1)
    })

    await recorder.use(
      createFrequencyHistogramPlugin({
        fftSize: 512,
        barCount: 8,
        frameInterval: 2,
      })
    )
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame(createSineFrame(220, 16000, 512, 0))
    adapter.session?.emitFrame(createSineFrame(220, 16000, 512, 20))
    recorder.pause()
    adapter.session?.emitFrame(createSineFrame(220, 16000, 512, 40))
    await recorder.resume()
    adapter.session?.emitFrame(createSineFrame(220, 16000, 512, 60))

    expect(eventCount).toHaveLength(2)
  })

  it("ignores empty and silent frames and stops emitting after stop", async () => {
    const adapter = new FakeFrequencyInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const eventCount: number[] = []

    recorder.on("plugin:fft", () => {
      eventCount.push(1)
    })

    await recorder.use(
      createFrequencyHistogramPlugin({
        fftSize: 512,
        barCount: 12,
      })
    )
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(0)], 16000, 0)
    )
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(512)], 16000, 10)
    )
    await recorder.stop()
    adapter.session?.emitFrame(createSineFrame(440, 16000, 512, 20))

    expect(eventCount).toHaveLength(0)
  })

  it("emits a single zero spectrum frame when the signal falls back to silence", async () => {
    const adapter = new FakeFrequencyInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const peaks: number[] = []

    recorder.on("plugin:fft", ({ payload }) => {
      peaks.push(Math.max(...Array.from(payload.bars)))
    })

    await recorder.use(
      createFrequencyHistogramPlugin({
        fftSize: 512,
        barCount: 12,
      })
    )
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame(createSineFrame(440, 16000, 512, 0))
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(512)], 16000, 20)
    )
    adapter.session?.emitFrame(
      createAudioFrame([new Float32Array(512)], 16000, 40)
    )

    expect(peaks).toHaveLength(2)
    expect(peaks[0]).toBeGreaterThan(0.1)
    expect(peaks[1]).toBe(0)
  })
})

function createSineFrame(
  frequency: number,
  sampleRate: number,
  length: number,
  timestamp: number
) {
  const channel = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    channel[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate)
  }
  return createAudioFrame([channel], sampleRate, timestamp)
}
