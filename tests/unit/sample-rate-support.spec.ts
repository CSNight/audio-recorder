import { describe, expect, it } from "vitest"
import { aacExportEncoder } from "../../src/codecs/aac"
import {
  ac3ExportEncoder,
  eac3ExportEncoder,
} from "../../src/codecs/ac3"
import { amrExportEncoder } from "../../src/codecs/amr"
import { pcmExportEncoder } from "../../src/codecs/base"
import { wavExportEncoder } from "../../src/codecs/base"
import { flacExportEncoder } from "../../src/codecs/flac"
import { g711ExportEncoder } from "../../src/codecs/g711"
import { mp3ExportEncoder } from "../../src/codecs/mp3"
import { oggExportEncoder } from "../../src/codecs/opus"

describe("encoder sample rate support predicates", () => {
  it("accepts any positive integer sample rate for PCM and WAV", () => {
    expect(pcmExportEncoder.isSupportSampleRate?.(16000)).toBe(true)
    expect(wavExportEncoder.isSupportSampleRate?.(48000)).toBe(true)
    expect(pcmExportEncoder.isSupportSampleRate?.(0)).toBe(false)
    expect(wavExportEncoder.isSupportSampleRate?.(16000.5)).toBe(false)
  })

  it("matches FFmpeg AAC sample rates", () => {
    expect(aacExportEncoder.isSupportSampleRate?.(7350)).toBe(true)
    expect(aacExportEncoder.isSupportSampleRate?.(96000)).toBe(true)
    expect(aacExportEncoder.isSupportSampleRate?.(12345)).toBe(false)
  })

  it("matches MPEG Layer III sample rates", () => {
    expect(mp3ExportEncoder.isSupportSampleRate?.(11025)).toBe(true)
    expect(mp3ExportEncoder.isSupportSampleRate?.(48000)).toBe(true)
    expect(mp3ExportEncoder.isSupportSampleRate?.(96000)).toBe(false)
  })

  it("matches libopus sample rates", () => {
    expect(oggExportEncoder.isSupportSampleRate?.(16000)).toBe(true)
    expect(oggExportEncoder.isSupportSampleRate?.(44100)).toBe(false)
  })

  it("matches FLAC's broad format range", () => {
    expect(flacExportEncoder.isSupportSampleRate?.(1)).toBe(true)
    expect(flacExportEncoder.isSupportSampleRate?.(1048575)).toBe(true)
    expect(flacExportEncoder.isSupportSampleRate?.(0)).toBe(false)
    expect(flacExportEncoder.isSupportSampleRate?.(1048576)).toBe(false)
  })

  it("matches G.711's current library behavior", () => {
    expect(g711ExportEncoder.isSupportSampleRate?.(8000)).toBe(true)
    expect(g711ExportEncoder.isSupportSampleRate?.(44100)).toBe(true)
    expect(g711ExportEncoder.isSupportSampleRate?.(-1)).toBe(false)
  })

  it("matches AMR narrowband and wideband fixed rates", () => {
    expect(
      amrExportEncoder.isSupportSampleRate?.(8000, { bandMode: "nb" })
    ).toBe(true)
    expect(
      amrExportEncoder.isSupportSampleRate?.(16000, { bandMode: "nb" })
    ).toBe(false)
    expect(
      amrExportEncoder.isSupportSampleRate?.(16000, { bandMode: "wb" })
    ).toBe(true)
    expect(
      amrExportEncoder.isSupportSampleRate?.(8000, { bandMode: "wb" })
    ).toBe(false)
  })

  it("matches AC3 and E-AC3 sample rates", () => {
    expect(ac3ExportEncoder.isSupportSampleRate?.(48000)).toBe(true)
    expect(ac3ExportEncoder.isSupportSampleRate?.(24000)).toBe(false)
    expect(eac3ExportEncoder.isSupportSampleRate?.(24000)).toBe(true)
    expect(eac3ExportEncoder.isSupportSampleRate?.(12345)).toBe(false)
  })
})
