import { describe, expect, it } from "vitest"
import { resolveExportSampleRate as resolveAacExportSampleRate } from "../../src/codecs/aac/sample-rate"
import { resolveExportSampleRate as resolveAc3ExportSampleRate } from "../../src/codecs/ac3/sample-rate"
import {
  resolveExportProfile as resolveAmrExportProfile,
  resolveExportSampleRate as resolveAmrExportSampleRate,
} from "../../src/codecs/amr/sample-rate"
import { resolveExportSampleRate as resolveBaseExportSampleRate } from "../../src/codecs/base/sample-rate"
import { resolveExportSampleRate as resolveFlacExportSampleRate } from "../../src/codecs/flac/sample-rate"
import { resolveExportSampleRate as resolveG711ExportSampleRate } from "../../src/codecs/g711/sample-rate"
import { resolveExportSampleRate as resolveMp3ExportSampleRate } from "../../src/codecs/mp3/sample-rate"
import { resolveExportSampleRate as resolveOpusExportSampleRate } from "../../src/codecs/opus/sample-rate"

describe("export sample rate resolution", () => {
  it("keeps explicit supported sample rates", () => {
    expect(resolveAacExportSampleRate(44100, 48000)).toBe(44100)
    expect(resolveMp3ExportSampleRate(32000, 44100)).toBe(32000)
    expect(resolveOpusExportSampleRate(16000, 48000)).toBe(16000)
    expect(resolveAc3ExportSampleRate(48000, 44100, "ac3")).toBe(48000)
    expect(resolveAmrExportSampleRate(16000, 8000)).toBe(16000)
  })

  it("maps explicit unsupported sample rates to the nearest supported value", () => {
    expect(resolveAacExportSampleRate(47000, 48000)).toBe(48000)
    expect(resolveMp3ExportSampleRate(15000, 44100)).toBe(16000)
    expect(resolveOpusExportSampleRate(44100, 48000)).toBe(48000)
    expect(resolveAc3ExportSampleRate(24000, 44100, "ac3")).toBe(32000)
    expect(resolveAc3ExportSampleRate(30000, 44100, "eac3")).toBe(32000)
    expect(resolveAmrExportSampleRate(12000, 8000)).toBe(8000)
    expect(resolveAmrExportSampleRate(12000, 8000, "wb")).toBe(16000)
  })

  it("uses the nearest supported sample rate when not explicitly set", () => {
    expect(resolveAacExportSampleRate(undefined, 47999)).toBe(48000)
    expect(resolveMp3ExportSampleRate(undefined, 15000)).toBe(16000)
    expect(resolveOpusExportSampleRate(undefined, 44100)).toBe(48000)
    expect(resolveAc3ExportSampleRate(undefined, 16000, "ac3")).toBe(32000)
    expect(resolveAc3ExportSampleRate(undefined, 30000, "eac3")).toBe(32000)
    expect(resolveAmrExportSampleRate(undefined, 12000)).toBe(8000)
    expect(resolveAmrExportSampleRate(undefined, 12000, "wb")).toBe(16000)
  })

  it("passes through actual sample rates for open-range encoders", () => {
    expect(resolveBaseExportSampleRate(undefined, 47999)).toBe(47999)
    expect(resolveG711ExportSampleRate(undefined, 44100)).toBe(44100)
    expect(resolveFlacExportSampleRate(undefined, 192000)).toBe(192000)
  })

  it("keeps AMR tied to the selected band mode", () => {
    expect(resolveAmrExportProfile({ bandMode: "nb" }, 44100)).toEqual({
      bandMode: "nb",
      sampleRate: 8000,
    })
    expect(resolveAmrExportProfile({ bandMode: "wb" }, 44100)).toEqual({
      bandMode: "wb",
      sampleRate: 16000,
    })
    expect(resolveAmrExportProfile({ sampleRate: 16000 }, 8000)).toEqual({
      bandMode: "wb",
      sampleRate: 16000,
    })
    expect(resolveAmrExportProfile({}, 12000)).toEqual({
      bandMode: "nb",
      sampleRate: 8000,
    })
    expect(resolveAmrExportProfile({ bandMode: "wb" }, 12000)).toEqual({
      bandMode: "wb",
      sampleRate: 16000,
    })
  })
})
