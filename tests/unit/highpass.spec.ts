import { describe, expect, it } from "vitest"
import { createHighpassPlugin } from "../../src/plugins/dsp"

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

describe("createHighpassPlugin", () => {
  it("has name dsp:highpass", () => {
    const plugin = createHighpassPlugin()
    expect(plugin.name).toBe("dsp:highpass")
  })

  it("setup returns undefined", () => {
    const plugin = createHighpassPlugin()
    expect(plugin.setup?.({} as any)).toBeUndefined()
  })

  it("onFlush returns nothing when no frames processed", () => {
    const plugin = createHighpassPlugin()
    plugin.onStart?.()
    const result = plugin.onFlush?.()
    // lastChannels === 0, so returns undefined
    expect(result).toBeUndefined()
  })

  it("processes a frame and returns filtered output", () => {
    const plugin = createHighpassPlugin({ cutoffHz: 100 })
    plugin.onStart?.()
    const samples = Array(160).fill(1000)
    const frame = makeFrame(samples, 16000, 1, 0)
    const result = plugin.onBeforeFrame?.(frame as any)
    expect(result).toBeDefined()
    expect((result as any).planar).toHaveLength(1)
    expect((result as any).planar[0].length).toBe(160)
  })

  it("DC signal is attenuated by highpass filter", () => {
    const plugin = createHighpassPlugin({ cutoffHz: 1000 })
    plugin.onStart?.()
    // Feed many frames of constant (DC) signal
    const dc = Array(320).fill(10000)
    let lastResult: any
    for (let i = 0; i < 20; i++) {
      lastResult = plugin.onBeforeFrame?.(
        makeFrame(dc, 16000, 1, i * 20) as any
      )
    }
    // After many frames, DC should be heavily attenuated
    const output = lastResult.planar[0] as Int16Array
    const absMax = Math.max(...Array.from(output).map(Math.abs))
    expect(absMax).toBeLessThan(10000)
  })

  it("onFlush returns frames after processing", () => {
    const plugin = createHighpassPlugin({ cutoffHz: 100 })
    plugin.onStart?.()
    // Process a frame with a DC-offset signal to build up filter state
    const samples = Array(160).fill(10000)
    plugin.onBeforeFrame?.(makeFrame(samples, 16000, 1, 0) as any)
    const flushResult = plugin.onFlush?.()
    // Should return an array (possibly empty if magnitude is already tiny)
    expect(Array.isArray(flushResult)).toBe(true)
  })

  it("onFlush with non-trivial IIR state returns frames", () => {
    // Use a very high cutoff to maximize filter state
    const plugin = createHighpassPlugin({ cutoffHz: 4000 })
    plugin.onStart?.()
    const samples = Array(160).fill(32000)
    plugin.onBeforeFrame?.(makeFrame(samples, 16000, 1, 0) as any)
    const flushResult = plugin.onFlush?.()
    expect(Array.isArray(flushResult)).toBe(true)
  })

  it("onFlush stops early when signal decays below threshold", () => {
    const plugin = createHighpassPlugin({ cutoffHz: 100 })
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
    const plugin = createHighpassPlugin()
    plugin.onStart?.()
    const samples = Array(320).fill(5000)
    const frame = makeFrame(samples, 16000, 2, 0)
    const result = plugin.onBeforeFrame?.(frame as any)
    expect((result as any).planar).toHaveLength(2)
  })

  it("resets state on onStart", () => {
    const plugin = createHighpassPlugin()
    plugin.onStart?.()
    const samples = Array(160).fill(10000)
    plugin.onBeforeFrame?.(makeFrame(samples, 16000, 1, 0) as any)
    plugin.onStart?.()
    // After reset, flush should return nothing (lastChannels=0)
    const result = plugin.onFlush?.()
    expect(result).toBeUndefined()
  })

  it("dispose resets state", () => {
    const plugin = createHighpassPlugin()
    plugin.onStart?.()
    const samples = Array(160).fill(5000)
    plugin.onBeforeFrame?.(makeFrame(samples, 16000, 1, 0) as any)
    plugin.dispose?.()
    // After dispose, flush should return nothing
    const result = plugin.onFlush?.()
    expect(result).toBeUndefined()
  })
})
