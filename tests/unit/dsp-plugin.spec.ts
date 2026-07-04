import { describe, expect, it } from "vitest"
import {
  createHighpassPlugin,
  createLowpassPlugin,
  createNoiseGatePlugin,
} from "../../src/plugins/dsp"
import type { RecorderPlugin } from "../../src/plugins/types"
import { createAudioFrame } from "../../src/utils/audio-frame"

describe("DSP plugins", () => {
  it("highpass attenuates low-frequency content and can flush a short tail", () => {
    const plugin = createHighpassPlugin({
      cutoffHz: 200,
    })

    plugin.setup({} as never)
    plugin.onStart?.()

    const input = createAudioFrame(
      [new Float32Array(Array.from({ length: 128 }, () => 0.5))],
      16_000,
      10
    )
    const output = runBeforeFrame(plugin, input)
    const flushed = plugin.onFlush?.() ?? []

    expect(Math.abs(output.planar[0]![127] ?? 0)).toBeLessThan(2000)
    expect(flushed.length).toBeGreaterThan(0)
    expect(Math.abs(flushed[0]?.planar[0]?.[0] ?? 0)).toBeGreaterThan(0)
  })

  it("lowpass attenuates high-frequency alternation and can flush a short tail", () => {
    const plugin = createLowpassPlugin({
      cutoffHz: 600,
    })

    plugin.setup({} as never)
    plugin.onStart?.()

    const alternating = new Float32Array(
      Array.from({ length: 128 }, (_, index) => (index % 2 === 0 ? 1 : -1))
    )
    const input = createAudioFrame([alternating], 16_000, 10)
    const output = runBeforeFrame(plugin, input)
    const inputAverage = averageAbsolute(input.planar[0]!)
    const outputAverage = averageAbsolute(output.planar[0]!)
    const flushed = plugin.onFlush?.() ?? []

    expect(outputAverage).toBeLessThan(inputAverage / 2)
    expect(flushed.length).toBeGreaterThan(0)
  })

  it("noise gate silences low-level frames and keeps louder frames passing", () => {
    const plugin = createNoiseGatePlugin({
      thresholdDb: -30,
      attackMs: 1,
      releaseMs: 1,
    })

    plugin.setup({} as never)
    plugin.onStart?.()

    const quiet = runBeforeFrame(
      plugin,
      createAudioFrame(
        [new Float32Array(Array.from({ length: 64 }, () => 0.005))],
        16_000,
        10
      )
    )
    const loud = runBeforeFrame(
      plugin,
      createAudioFrame(
        [new Float32Array(Array.from({ length: 64 }, () => 0.4))],
        16_000,
        20
      )
    )

    expect(averageAbsolute(quiet.planar[0]!)).toBeLessThan(20)
    expect(averageAbsolute(loud.planar[0]!)).toBeGreaterThan(1000)
  })
})

function runBeforeFrame(
  plugin: RecorderPlugin,
  frame: ReturnType<typeof createAudioFrame>
) {
  return plugin.onBeforeFrame?.(frame) ?? frame
}

function averageAbsolute(samples: Int16Array): number {
  let total = 0
  for (let index = 0; index < samples.length; index += 1) {
    total += Math.abs(samples[index] ?? 0)
  }

  return samples.length === 0 ? 0 : total / samples.length
}
