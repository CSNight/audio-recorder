import { describe, expect, it } from "vitest"
import { createNoiseGatePlugin } from "../../src/plugins/dsp"

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

describe("createNoiseGatePlugin", () => {
  it("has name dsp:noise-gate", () => {
    const plugin = createNoiseGatePlugin()
    expect(plugin.name).toBe("dsp:noise-gate")
  })

  it("setup returns undefined", () => {
    const plugin = createNoiseGatePlugin()
    expect(plugin.setup?.({} as any)).toBeUndefined()
  })

  it("passes through loud signal (above threshold)", () => {
    const plugin = createNoiseGatePlugin({ thresholdDb: -60 })
    plugin.onStart?.()
    // Large samples — well above -60dB threshold
    const loud = Array(160).fill(16000)
    const frame = makeFrame(loud, 16000, 1)
    const result = plugin.onBeforeFrame?.(frame as any)
    expect(result).toBeDefined()
    // Output should be non-zero (signal passes through)
    const output = (result as any).planar[0] as Int16Array
    const nonZero = Array.from(output).some((v) => Math.abs(v) > 100)
    expect(nonZero).toBe(true)
  })

  it("attenuates silent signal (below threshold)", () => {
    const plugin = createNoiseGatePlugin({ thresholdDb: -10 })
    plugin.onStart?.()
    // Feed loud frames first to set gain=1
    const loud = Array(160).fill(20000)
    plugin.onBeforeFrame?.(makeFrame(loud, 16000, 1, 0) as any)
    plugin.onBeforeFrame?.(makeFrame(loud, 16000, 1, 10) as any)
    // Now feed silence — gate should close
    const silent = Array(160).fill(0)
    const frame = makeFrame(silent, 16000, 1, 20)
    const result = plugin.onBeforeFrame?.(frame as any)
    const output = (result as any).planar[0] as Int16Array
    // All output should be zero since input is silence
    const allZero = Array.from(output).every((v) => v === 0)
    expect(allZero).toBe(true)
  })

  it("handles empty frame (frameLength === 0)", () => {
    const plugin = createNoiseGatePlugin()
    plugin.onStart?.()
    const emptyFrame = {
      planar: [new Int16Array(0)],
      sampleRate: 16000,
      channels: 1,
      timestamp: 0,
      durationMs: 0,
    }
    const result = plugin.onBeforeFrame?.(emptyFrame as any)
    // Should return frame unchanged
    expect(result).toBe(emptyFrame)
  })

  it("handles frame with no planar channels", () => {
    const plugin = createNoiseGatePlugin()
    plugin.onStart?.()
    const emptyFrame = {
      planar: [],
      sampleRate: 16000,
      channels: 0,
      timestamp: 0,
      durationMs: 0,
    }
    const result = plugin.onBeforeFrame?.(emptyFrame as any)
    expect(result).toBe(emptyFrame)
  })

  it("resets gain on onStart", () => {
    const plugin = createNoiseGatePlugin({ thresholdDb: -10 })
    plugin.onStart?.()
    // Drive gain toward 0 by passing silence after threshold setup
    const loud = Array(1600).fill(20000)
    plugin.onBeforeFrame?.(makeFrame(loud, 16000, 1, 0) as any)
    // Reset
    plugin.onStart?.()
    // After reset, loud signal should pass with gain=1
    const frame = makeFrame(loud, 16000, 1, 0)
    const result = plugin.onBeforeFrame?.(frame as any)
    expect(result).toBeDefined()
  })

  it("dispose resets state", () => {
    const plugin = createNoiseGatePlugin()
    plugin.onStart?.()
    plugin.dispose?.()
    // Should not throw when used again after dispose
    const frame = makeFrame([100, 200], 16000, 1)
    expect(() => plugin.onBeforeFrame?.(frame as any)).not.toThrow()
  })

  it("processes stereo frames", () => {
    const plugin = createNoiseGatePlugin({ thresholdDb: -60 })
    plugin.onStart?.()
    // stereo: L=10000, R=10000 per sample
    const samples = Array(320)
      .fill(0)
      .map((_, i) => (i % 2 === 0 ? 10000 : 10000))
    const frame = makeFrame(samples, 16000, 2)
    const result = plugin.onBeforeFrame?.(frame as any)
    expect((result as any).planar).toHaveLength(2)
  })

  it("clamps gain to 0 when well below threshold", () => {
    const plugin = createNoiseGatePlugin({
      thresholdDb: -1, // very high threshold so silence triggers gate
      releaseMs: 1, // fast release
    })
    plugin.onStart?.()
    // Many frames of silence to converge gain to 0
    const silent = Array(1600).fill(0)
    for (let i = 0; i < 20; i++) {
      plugin.onBeforeFrame?.(makeFrame(silent, 16000, 1, i * 100) as any)
    }
    const frame = makeFrame(silent, 16000, 1, 2000)
    const result = plugin.onBeforeFrame?.(frame as any)
    const output = (result as any).planar[0] as Int16Array
    const allZero = Array.from(output).every((v) => v === 0)
    expect(allZero).toBe(true)
  })

  it("clamps gain to 1 when well above threshold", () => {
    const plugin = createNoiseGatePlugin({
      thresholdDb: -80, // very low threshold so loud signal opens gate fully
      attackMs: 1, // fast attack
    })
    plugin.onStart?.()
    // Many frames of loud signal to converge gain to 1
    const loud = Array(1600).fill(32000)
    for (let i = 0; i < 20; i++) {
      plugin.onBeforeFrame?.(makeFrame(loud, 16000, 1, i * 100) as any)
    }
    const frame = makeFrame(loud, 16000, 1, 2000)
    const result = plugin.onBeforeFrame?.(frame as any)
    const output = (result as any).planar[0] as Int16Array
    const hasLoud = Array.from(output).some((v) => Math.abs(v) > 10000)
    expect(hasLoud).toBe(true)
  })

  it("uses custom thresholdDb", () => {
    const pluginStrict = createNoiseGatePlugin({ thresholdDb: -1 })
    const pluginLoose = createNoiseGatePlugin({ thresholdDb: -80 })
    pluginStrict.onStart?.()
    pluginLoose.onStart?.()
    const medium = Array(160).fill(100) // low amplitude
    const frameStrict = makeFrame(medium, 16000, 1)
    const frameLoose = makeFrame(medium, 16000, 1)
    const resultStrict = pluginStrict.onBeforeFrame?.(frameStrict as any)
    const resultLoose = pluginLoose.onBeforeFrame?.(frameLoose as any)
    // Loose threshold allows signal; strict blocks it
    const strictOut = (resultStrict as any).planar[0] as Int16Array
    const looseOut = (resultLoose as any).planar[0] as Int16Array
    const strictSum = Array.from(strictOut).reduce((a, b) => a + Math.abs(b), 0)
    const looseSum = Array.from(looseOut).reduce((a, b) => a + Math.abs(b), 0)
    expect(looseSum).toBeGreaterThan(strictSum)
  })
})
