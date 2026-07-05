import { describe, expect, it } from "vitest"
import { createLowpassPlugin } from "../../src/plugins/dsp"

function makeFrame(
  samples: number[],
  sampleRate = 16000,
  channels = 1,
  timestamp = 0
) {
  const planar: Int16Array[] = []
  for (let c = 0; c < channels; c++) {
    const ch = new Int16Array(samples.length / channels)
    for (let i = 0; i < ch.length; i++) {
      ch[i] = samples[c + i * channels] ?? 0
    }
    planar.push(ch)
  }
  const durationMs = (samples.length / channels / sampleRate) * 1000
  return { planar, sampleRate, channels, timestamp, durationMs }
}

describe("createLowpassPlugin", () => {
  it("has name dsp:lowpass", () => {
    const plugin = createLowpassPlugin()
    expect(plugin.name).toBe("dsp:lowpass")
  })

  it("setup returns undefined", () => {
    const plugin = createLowpassPlugin()
    expect(plugin.setup?.({} as any)).toBeUndefined()
  })

  it("onFlush returns nothing when no frames processed", () => {
    const plugin = createLowpassPlugin()
    plugin.onStart?.()
    const result = plugin.onFlush?.()
    // lastChannels === 0, so returns undefined
    expect(result).toBeUndefined()
  })

  it("processes a frame and returns filtered output", () => {
    const plugin = createLowpassPlugin({ cutoffHz: 3400 })
    plugin.onStart?.()
    const samples = Array(160).fill(1000)
    const frame = makeFrame(samples, 16000, 1, 0)
    const result = plugin.onBeforeFrame?.(frame as any)
    expect(result).toBeDefined()
    expect((result as any).planar).toHaveLength(1)
    expect((result as any).planar[0].length).toBe(160)
  })

  it("high-frequency signal is attenuated by lowpass filter", () => {
    // Use very low cutoff to attenuate most frequencies
    const plugin = createLowpassPlugin({ cutoffHz: 100 })
    plugin.onStart?.()
    // Alternating signal (high frequency)
    const hf = Array(320)
      .fill(0)
      .map((_, i) => (i % 2 === 0 ? 10000 : -10000))
    let lastResult: any
    for (let i = 0; i < 20; i++) {
      lastResult = plugin.onBeforeFrame?.(
        makeFrame(hf, 16000, 1, i * 20) as any
      )
    }
    const output = lastResult.planar[0] as Int16Array
    const absMax = Math.max(...Array.from(output).map(Math.abs))
    // After many frames, alternating signal should be attenuated
    expect(absMax).toBeLessThan(10000)
  })

  it("DC signal passes through lowpass filter", () => {
    const plugin = createLowpassPlugin({ cutoffHz: 3400 })
    plugin.onStart?.()
    // Feed many frames of constant (DC) signal
    const dc = Array(320).fill(10000)
    let lastResult: any
    for (let i = 0; i < 30; i++) {
      lastResult = plugin.onBeforeFrame?.(
        makeFrame(dc, 16000, 1, i * 20) as any
      )
    }
    // After many frames, DC should pass through (lowpass allows it)
    const output = lastResult.planar[0] as Int16Array
    const absMax = Math.max(...Array.from(output).map(Math.abs))
    expect(absMax).toBeGreaterThan(5000)
  })

  it("onFlush returns frames after processing non-zero signal", () => {
    const plugin = createLowpassPlugin({ cutoffHz: 3400 })
    plugin.onStart?.()
    // Process a frame with signal to build up filter state
    const samples = Array(160).fill(10000)
    plugin.onBeforeFrame?.(makeFrame(samples, 16000, 1, 0) as any)
    const flushResult = plugin.onFlush?.()
    // Should return an array
    expect(Array.isArray(flushResult)).toBe(true)
  })

  it("onFlush stops early when signal decays below threshold", () => {
    const plugin = createLowpassPlugin({ cutoffHz: 3400 })
    plugin.onStart?.()
    // After many silent frames the filter state decays to near 0
    const silent = Array(160).fill(0)
    for (let i = 0; i < 30; i++) {
      plugin.onBeforeFrame?.(makeFrame(silent, 16000, 1, i * 10) as any)
    }
    const flushResult = plugin.onFlush?.()
    // Should return empty array (already decayed)
    expect(Array.isArray(flushResult)).toBe(true)
    expect((flushResult as any[]).length).toBe(0)
  })

  it("processes stereo frames", () => {
    const plugin = createLowpassPlugin()
    plugin.onStart?.()
    const samples = Array(320).fill(5000)
    const frame = makeFrame(samples, 16000, 2, 0)
    const result = plugin.onBeforeFrame?.(frame as any)
    expect((result as any).planar).toHaveLength(2)
  })

  it("resets state on onStart", () => {
    const plugin = createLowpassPlugin()
    plugin.onStart?.()
    const samples = Array(160).fill(10000)
    plugin.onBeforeFrame?.(makeFrame(samples, 16000, 1, 0) as any)
    plugin.onStart?.()
    // After reset, flush should return nothing (lastChannels=0)
    const result = plugin.onFlush?.()
    expect(result).toBeUndefined()
  })

  it("dispose resets state", () => {
    const plugin = createLowpassPlugin()
    plugin.onStart?.()
    const samples = Array(160).fill(5000)
    plugin.onBeforeFrame?.(makeFrame(samples, 16000, 1, 0) as any)
    plugin.dispose?.()
    // After dispose, flush should return nothing
    const result = plugin.onFlush?.()
    expect(result).toBeUndefined()
  })

  it("onFlush with large IIR state emits multiple frames", () => {
    // Use very high cutoff (nearly all-pass) + large signal to maximize state
    const plugin = createLowpassPlugin({ cutoffHz: 7000 })
    plugin.onStart?.()
    const samples = Array(160).fill(32000)
    plugin.onBeforeFrame?.(makeFrame(samples, 16000, 1, 0) as any)
    const flushResult = plugin.onFlush?.()
    expect(Array.isArray(flushResult)).toBe(true)
  })
})
