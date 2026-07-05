import { describe, expect, it } from "vitest"
import type {
  InputSessionSummary,
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputSession,
} from "../../src/input/types"
import { RecorderController } from "../../src"
import {
  createDtmfDecoderPlugin,
  encodeDtmf,
  lookupDtmfFrequencies,
} from "../../src/plugins/dtmf"
import { DtmfDetector } from "../../src/plugins/dtmf/decode"
import { createAudioFrame } from "../../src/utils/audio-frame"

class FakeDtmfInputSession implements RecorderInputSession {
  constructor(
    private readonly handlers: RecorderInputHandlers,
    public readonly actualSampleRate = 8000,
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

  emitPcmFrame(
    pcm: Int16Array,
    sampleRate: number,
    timestampMs: number,
    channels = 1
  ): void {
    this.handlers.onFrame(
      createFrameFromPcm(pcm, sampleRate, timestampMs, channels)
    )
  }
}

class FakeDtmfInputAdapter implements RecorderInputAdapter {
  session: FakeDtmfInputSession | undefined

  async open(
    _request: Parameters<RecorderInputAdapter["open"]>[0],
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession> {
    this.session = new FakeDtmfInputSession(handlers)
    return this.session
  }
}

describe("DTMF plugin", () => {
  it("encodes DTMF PCM data", () => {
    const pcm = encodeDtmf(["1", "2", "3"], {
      sampleRate: 8000,
      toneMs: 80,
      gapMs: 20,
    })

    expect(pcm.length).toBeGreaterThan(0)
    expect(
      Math.max(...Array.from(pcm).map((sample) => Math.abs(sample)))
    ).toBeGreaterThan(1000)
    expect(lookupDtmfFrequencies("1")).toEqual([697, 1209])
  })

  it("detects DTMF keys from recorder frames", async () => {
    const adapter = new FakeDtmfInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const detected: string[] = []

    recorder.on("plugin:dtmf:detect", ({ payload }) => {
      detected.push(payload.key)
    })

    await recorder.use(
      createDtmfDecoderPlugin({
        frameWindowMs: 40,
        minToneMs: 40,
        minGapMs: 20,
        energyThreshold: 0.02,
      })
    )
    await recorder.open()
    await recorder.start()

    const pcm = encodeDtmf(["5"], {
      sampleRate: 8000,
      toneMs: 120,
      gapMs: 0,
      amplitude: 0.9,
    })
    adapter.session?.emitPcmFrame(pcm.subarray(0, 320), 8000, 0)
    adapter.session?.emitPcmFrame(pcm.subarray(320, 640), 8000, 40)
    adapter.session?.emitPcmFrame(pcm.subarray(640), 8000, 80)

    expect(detected).toEqual(["5"])
  })

  it("does not emit while paused", async () => {
    const adapter = new FakeDtmfInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const detected: string[] = []

    recorder.on("plugin:dtmf:detect", ({ payload }) => {
      detected.push(payload.key)
    })

    await recorder.use(createDtmfDecoderPlugin())
    await recorder.open()
    await recorder.start()
    recorder.pause()
    const pcm = encodeDtmf(["1"], {
      sampleRate: 8000,
      toneMs: 120,
      gapMs: 0,
    })
    adapter.session?.emitPcmFrame(pcm, 8000, 0)

    expect(detected).toHaveLength(0)
  })

  it("detects DTMF from stereo frames and can detect again after restart", async () => {
    const adapter = new FakeDtmfInputAdapter()
    const recorder = new RecorderController({
      inputAdapter: adapter,
      storageOptions: undefined,
    })
    const detected: string[] = []

    recorder.on("plugin:dtmf:detect", ({ payload }) => {
      detected.push(payload.key)
    })

    await recorder.use(
      createDtmfDecoderPlugin({
        frameWindowMs: 40,
        minToneMs: 40,
        minGapMs: 20,
        energyThreshold: 0.02,
      })
    )
    await recorder.open({ channelCount: 2 })
    await recorder.start()

    const first = encodeDtmf(["8"], {
      sampleRate: 8000,
      toneMs: 120,
      gapMs: 0,
    })
    adapter.session?.emitPcmFrame(toStereo(first), 8000, 0, 2)
    await recorder.stop()
    await recorder.close()
    await recorder.open({ channelCount: 2 })
    await recorder.start()
    const second = encodeDtmf(["#"], {
      sampleRate: 8000,
      toneMs: 120,
      gapMs: 0,
    })
    adapter.session?.emitPcmFrame(toStereo(second), 8000, 200, 2)

    expect(detected).toEqual(["8", "#"])
  })

  it("detector ignores silence and resets on sample-rate change", () => {
    const detector = new DtmfDetector({
      frameWindowMs: 40,
      minToneMs: 40,
      minGapMs: 20,
      energyThreshold: 0.02,
    })

    const silent = detector.push(new Int16Array(320), 8000, 0)
    expect(silent).toEqual([])

    const tone = encodeDtmf(["2"], {
      sampleRate: 8000,
      toneMs: 120,
      gapMs: 0,
      amplitude: 0.9,
    })
    const first = detector.push(tone.subarray(0, 320), 8000, 40)
    const second = detector.push(tone.subarray(320, 640), 8000, 80)
    expect([...first, ...second].map((item) => item.key)).toEqual(["2"])

    const resampledReset = detector.push(new Int16Array(441), 11025, 120)
    expect(resampledReset).toEqual([])
  })
})

function createFrameFromPcm(
  pcm: Int16Array,
  sampleRate: number,
  timestampMs: number,
  channels = 1
) {
  const frameLength = Math.floor(pcm.length / channels)
  const planar = Array.from(
    { length: channels },
    () => new Float32Array(frameLength)
  )

  for (let frameIndex = 0; frameIndex < frameLength; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      planar[channelIndex]![frameIndex] =
        (pcm[frameIndex * channels + channelIndex] ?? 0) / 32768
    }
  }
  return createAudioFrame(planar, sampleRate, timestampMs)
}

function toStereo(mono: Int16Array): Int16Array {
  const stereo = new Int16Array(mono.length * 2)
  for (let index = 0; index < mono.length; index += 1) {
    const sample = mono[index] ?? 0
    stereo[index * 2] = sample
    stereo[index * 2 + 1] = sample
  }
  return stereo
}
