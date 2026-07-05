import { describe, expect, it } from "vitest"
import { wavExportEncoder } from "../../src/codecs/base"
import {
  DEFAULT_NMN_OPTIONS,
  DYNAMIC_VELOCITY,
  NMN_KEY_OFFSETS,
  nmn2pcm,
} from "../../src/plugins/nmn2pcm"

describe("nmn2pcm", () => {
  it("converts basic scale notes into mono PCM", () => {
    const result = nmn2pcm("1 2 3 4 5 6 7", {
      sampleRate: 16000,
      bpm: 120,
      volume: 0.7,
    })

    expect(result.channels).toBe(1)
    expect(result.sampleRate).toBe(16000)
    expect(result.durationMs).toBeGreaterThan(0)
    expect(result.data.length).toBeGreaterThan(0)
  })

  it("supports chords, dynamics, ties and ornaments", () => {
    const result = nmn2pcm("!pp! [1 3 5]- 1~1 !ff! tr(3) grace(2->3) turn(5)", {
      sampleRate: 8000,
      bpm: 90,
      key: "D",
      transpose: 1,
    })

    expect(result.channels).toBe(1)
    expect(result.durationMs).toBeGreaterThan(2000 / 3)
    expect(
      Math.max(...Array.from(result.data).map((sample) => Math.abs(sample)))
    ).toBeGreaterThan(1000)
  })

  it("integrates with the existing export encoder path", () => {
    const result = nmn2pcm("grace(2->3) [1 3 5] mord(5) 0 6.", {
      sampleRate: 16000,
      bpm: 100,
    })
    const wav = wavExportEncoder.export({
      sampleRate: result.sampleRate,
      channels: 1,
      frameCount: 1,
      durationMs: result.durationMs,
      planar: [result.data],
    })

    expect(wav.arrayBuffer.byteLength).toBeGreaterThan(44)
    expect(new Uint8Array(wav.arrayBuffer).slice(0, 4)).toEqual(
      new Uint8Array([0x52, 0x49, 0x46, 0x46])
    )
  })

  it("exposes reusable public constants from the subpath entry", () => {
    expect(DEFAULT_NMN_OPTIONS.key).toBe("C")
    expect(DYNAMIC_VELOCITY.mf).toBeGreaterThan(0)
    expect(NMN_KEY_OFFSETS["F#"]).toBe(6)
  })
})
