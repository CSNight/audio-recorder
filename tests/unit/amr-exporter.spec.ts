import { beforeAll, describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import {
  amrSnapshotEncoderDefinition,
  exportAmrSnapshot,
} from "@/codecs/amr/amr-snapshot-exporter"
import { preloadAmrModules } from "@/codecs/amr/amr-wasm-api"

function sine(length: number, freq = 440, sampleRate = 16000): Int16Array {
  const out = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000)
  }
  return out
}

function makeSnapshot(
  samplesPerChannel: number,
  channels = 1,
  sampleRate = 16000
): PcmBufferSnapshot {
  const planar: Int16Array[] = []
  for (let channel = 0; channel < channels; channel++) {
    planar.push(sine(samplesPerChannel, 440 + channel * 90, sampleRate))
  }

  return {
    sampleRate,
    channels,
    frameCount: 1,
    durationMs: (samplesPerChannel / sampleRate) * 1000,
    planar,
  }
}

describe("amrSnapshotEncoderDefinition", () => {
  beforeAll(async () => {
    await preloadAmrModules()
  })

  it("has type 'amr'", () => {
    expect(amrSnapshotEncoderDefinition.type).toBe("amr")
  })

  it("defaults to AMR-NB and resamples to 8000Hz", () => {
    const snapshot = makeSnapshot(16000, 1, 16000)
    const result = exportAmrSnapshot(snapshot)
    const header = new TextDecoder().decode(result.data.subarray(0, 6))

    expect(result.bandMode).toBe("nb")
    expect(result.sampleRate).toBe(8000)
    expect(result.channels).toBe(1)
    expect(result.mimeType).toBe("audio/amr")
    expect(header).toBe("#!AMR\n")
  })

  it("supports AMR-WB via bandMode option", () => {
    const snapshot = makeSnapshot(32000, 1, 32000)
    const result = exportAmrSnapshot(snapshot, { bandMode: "wb" })
    const header = new TextDecoder().decode(result.data.subarray(0, 9))

    expect(result.bandMode).toBe("wb")
    expect(result.sampleRate).toBe(16000)
    expect(result.mimeType).toBe("audio/amr-wb")
    expect(header).toBe("#!AMR-WB\n")
  })

  it("takes only the first channel for multi-channel input", () => {
    const snapshot = makeSnapshot(3200, 2, 16000)
    const result = exportAmrSnapshot(snapshot)

    expect(result.channels).toBe(1)
    expect(result.data.byteLength).toBeGreaterThan(6)
  })
})
