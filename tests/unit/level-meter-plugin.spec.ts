import { describe, expect, it } from "vitest"
import type {
  CaptureAdapter,
  CaptureHandlers,
  CaptureSession,
} from "@/capture/types"
import { RecorderController } from "@/core/recorder-controller"
import { createLevelMeterPlugin } from "@/plugins/level-meter/index"
import { createAudioFrame } from "@/utils/audio-frame"

class FakePluginCaptureSession implements CaptureSession {
  constructor(
    private readonly handlers: CaptureHandlers,
    public readonly actualSampleRate = 16_000,
    public readonly actualChannelCount = 1 as const
  ) {}

  async start(): Promise<void> {}

  pause(): void {}

  async resume(): Promise<void> {}

  async stop(): Promise<{ frames: number; durationMs: number }> {
    return { frames: 1, durationMs: 1 }
  }

  async close(): Promise<void> {}

  emitFrame(): void {
    this.handlers.onFrame(
      createAudioFrame([new Float32Array([0, 0.5, -0.5, 0.25])], 16_000, 10)
    )
  }
}

class FakePluginCaptureAdapter implements CaptureAdapter {
  session: FakePluginCaptureSession | undefined

  async open(
    _request: Parameters<CaptureAdapter["open"]>[0],
    handlers: CaptureHandlers
  ): Promise<CaptureSession> {
    this.session = new FakePluginCaptureSession(handlers)
    return this.session
  }
}

describe("createLevelMeterPlugin", () => {
  it("emits normalized level events from recorder frames", async () => {
    const adapter = new FakePluginCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
      storageOptions: undefined,
    })
    const levels: { peak: number; rms: number; pluginName: string }[] = []

    recorder.on("level", ({ payload, pluginName }) => {
      levels.push({
        peak: payload.level.peak,
        rms: payload.level.rms,
        pluginName,
      })
    })

    await recorder.use(createLevelMeterPlugin())
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame()

    expect(levels).toHaveLength(1)
    expect(levels[0]?.pluginName).toBe("level-meter")
    expect(levels[0]?.peak).toBeCloseTo(0.5, 4)
    expect(levels[0]?.rms).toBeGreaterThan(0)
    expect(levels[0]?.rms).toBeLessThan(0.5)
  })

  it("stops emitting while paused or stopped", async () => {
    const adapter = new FakePluginCaptureAdapter()
    const recorder = new RecorderController({
      captureAdapter: adapter,
      storageOptions: undefined,
    })
    const levels: number[] = []

    recorder.on("level", ({ payload }) => {
      levels.push(payload.level.peak)
    })

    await recorder.use(createLevelMeterPlugin())
    await recorder.open()
    await recorder.start()
    adapter.session?.emitFrame()
    recorder.pause()
    adapter.session?.emitFrame()
    await recorder.resume()
    adapter.session?.emitFrame()
    await recorder.stop()
    adapter.session?.emitFrame()

    expect(levels).toHaveLength(2)
  })
})
