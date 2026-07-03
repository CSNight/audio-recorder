import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PcmBufferSnapshot } from "../../src/buffer/types"
import type { Ac3EncoderHandle } from "../../src/codecs/ac3"

const preloadAc3Module = vi.fn(async () => {})
const createAc3Encoder = vi.fn<(options: unknown) => Ac3EncoderHandle>()

const mockEncode = vi.fn<(pcm: Int16Array) => Uint8Array[]>()
const mockFlush = vi.fn<() => Uint8Array[]>()
const mockFree = vi.fn<() => void>()

vi.mock("../../src/codecs/ac3/ac3-wasm-api", () => ({
  preloadAc3Module,
  createAc3Encoder,
  resolveAc3EncoderOptions: (
    options: Record<string, unknown> = {},
    sampleRate: number,
    channels: number
  ) => ({
    codec: (options.codec as "ac3" | "eac3" | undefined) ?? "ac3",
    bitrate:
      (options.bitrate as number | undefined) ??
      (((options.codec as string | undefined) ?? "ac3") === "ac3"
        ? 384000
        : 192000),
    sampleRate: ((options.sampleRate as number | undefined) ?? sampleRate) as
      | 16000
      | 22050
      | 24000
      | 32000
      | 44100
      | 48000,
    channels,
  }),
}))

const { ac3ExportEncoder, eac3ExportEncoder, exportAc3Snapshot } =
  await import("../../src/codecs/ac3/ac3-snapshot-exporter")

function sine(length: number, freq = 440, sampleRate = 48000): Int16Array {
  const out = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 16000)
  }
  return out
}

function makeSnapshot(
  samplesPerChannel: number,
  channels = 2,
  sampleRate = 48000
): PcmBufferSnapshot {
  const planar: Int16Array[] = []
  for (let c = 0; c < channels; c++) {
    planar.push(sine(samplesPerChannel, 440 + c * 100, sampleRate))
  }
  return {
    sampleRate,
    channels,
    frameCount: 1,
    durationMs: (samplesPerChannel / sampleRate) * 1000,
    planar,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEncode.mockReturnValue([new Uint8Array([1, 2, 3])])
  mockFlush.mockReturnValue([new Uint8Array([4, 5])])
  createAc3Encoder.mockImplementation(
    (options: unknown) =>
      ({
        codec: (options as { codec: "ac3" | "eac3" }).codec,
        sampleRate: (options as { sampleRate: 48000 | 24000 }).sampleRate,
        channels: (options as { channels: number }).channels,
        bitrate: (options as { bitrate: number }).bitrate,
        frameSize: 6,
        encode: mockEncode,
        flush: mockFlush,
        free: mockFree,
      }) as Ac3EncoderHandle
  )
})

describe("ac3 export encoders", () => {
  it("exposes typed AC3 and EAC3 encoder definitions", async () => {
    expect(ac3ExportEncoder.type).toBe("ac3")
    expect(eac3ExportEncoder.type).toBe("eac3")
    expect(ac3ExportEncoder.preload).toBe(preloadAc3Module)
    await ac3ExportEncoder.preload?.()
    expect(preloadAc3Module).toHaveBeenCalledTimes(1)
  })

  it("pins codec selection through the encoder definitions", () => {
    const snapshot = makeSnapshot(6, 2)
    expect(ac3ExportEncoder.export(snapshot, {}).codec).toBe("ac3")
    expect(eac3ExportEncoder.export(snapshot, {}).codec).toBe("eac3")
  })
})

describe("exportAc3Snapshot", () => {
  it("produces merged AC3 data for full frames", () => {
    const result = exportAc3Snapshot(makeSnapshot(12, 2))
    expect(result.codec).toBe("ac3")
    expect(result.mimeType).toBe("audio/ac3")
    expect(result.sampleRate).toBe(48000)
    expect(result.channels).toBe(2)
    expect(result.bitrate).toBe(384000)
    expect(Array.from(result.data)).toEqual([1, 2, 3, 1, 2, 3, 4, 5])
  })

  it("resamples to the requested sample rate before encoding", () => {
    const result = exportAc3Snapshot(makeSnapshot(480, 2, 48000), {
      codec: "eac3",
      sampleRate: 24000,
    })

    expect(result.codec).toBe("eac3")
    expect(result.mimeType).toBe("audio/eac3")
    expect(result.sampleRate).toBe(24000)
    expect(createAc3Encoder).toHaveBeenCalledWith(
      expect.objectContaining({ codec: "eac3", sampleRate: 24000 })
    )
  })

  it("pads the final partial frame with silence", () => {
    exportAc3Snapshot(makeSnapshot(8, 2))
    const pcm = mockEncode.mock.calls[1]?.[0]
    expect(pcm).toBeInstanceOf(Int16Array)
    expect(pcm?.length).toBe(12)
    expect(Array.from((pcm as Int16Array).slice(8))).toEqual([0, 0, 0, 0])
  })

  it("skips empty packets and always frees the encoder", () => {
    mockEncode.mockReturnValueOnce([new Uint8Array(0)])
    mockFlush.mockReturnValue([new Uint8Array(0)])

    const result = exportAc3Snapshot(makeSnapshot(6, 2))
    expect(Array.from(result.data)).toEqual([])
    expect(mockFree).toHaveBeenCalledTimes(1)
  })
})
