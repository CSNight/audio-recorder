import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AmrEncoderHandle } from "@/codecs/amr/types"
import type { PcmBufferSnapshot } from "@/buffer/types"

const resample =
  vi.fn<
    (snapshot: PcmBufferSnapshot, sampleRate: number) => PcmBufferSnapshot
  >()
const createAmrEncoder = vi.fn<(options?: unknown) => AmrEncoderHandle>()
const getAmrStreamHeader = vi.fn<(bandMode: "nb" | "wb") => Uint8Array>()
const getAmrTargetSampleRate = vi.fn<(bandMode: "nb" | "wb") => 8000 | 16000>()
const getAmrMimeType = vi.fn<(bandMode: "nb" | "wb") => string>()
const preloadAmrModules = vi.fn()

vi.mock("audio-recorder", () => ({
  resample,
}))

vi.mock("@/codecs/amr/amr-wasm-api", () => ({
  createAmrEncoder,
  getAmrStreamHeader,
  getAmrTargetSampleRate,
  getAmrMimeType,
  preloadAmrModules,
}))

const { amrChunkedEncoderDefinition } =
  await import("@/codecs/amr/amr-chunked-encoder")
const { exportAmrSnapshot, amrSnapshotEncoderDefinition } =
  await import("@/codecs/amr/amr-snapshot-exporter")

function snapshot(planar: Int16Array[], sampleRate = 16000): PcmBufferSnapshot {
  return {
    sampleRate,
    channels: planar.length,
    frameCount: 1,
    durationMs: ((planar[0]?.length ?? 0) / sampleRate) * 1000,
    planar,
  }
}

describe("amr mocked behaviors", () => {
  const encode = vi.fn()
  const free = vi.fn()

  beforeEach(() => {
    resample.mockReset()
    createAmrEncoder.mockReset()
    getAmrStreamHeader.mockReset()
    getAmrTargetSampleRate.mockReset()
    getAmrMimeType.mockReset()
    preloadAmrModules.mockReset()
    encode.mockReset()
    free.mockReset()

    resample.mockImplementation((input) => input)
    getAmrTargetSampleRate.mockImplementation((bandMode) =>
      bandMode === "wb" ? 16000 : 8000
    )
    getAmrStreamHeader.mockImplementation((bandMode) =>
      new TextEncoder().encode(bandMode === "wb" ? "#!AMR-WB\n" : "#!AMR\n")
    )
    getAmrMimeType.mockImplementation((bandMode) =>
      bandMode === "wb" ? "audio/amr-wb" : "audio/amr"
    )
    createAmrEncoder.mockImplementation(
      (options) =>
        ({
          bandMode: ((options as { bandMode?: "nb" | "wb" })?.bandMode ??
            "nb") as "nb" | "wb",
          sampleRate:
            ((options as { bandMode?: "nb" | "wb" })?.bandMode ?? "nb") === "wb"
              ? 16000
              : 8000,
          frameSize:
            ((options as { bandMode?: "nb" | "wb" })?.bandMode ?? "nb") === "wb"
              ? 4
              : 2,
          encode,
          free,
        }) as unknown as AmrEncoderHandle
    )
  })

  it("exposes preload on both AMR definitions", () => {
    expect(amrChunkedEncoderDefinition.preload).toBe(preloadAmrModules)
    expect(amrSnapshotEncoderDefinition.preload).toBe(preloadAmrModules)
  })

  it("buffers chunked AMR frames, writes the header once, and flushes padded leftovers", () => {
    encode
      .mockReturnValueOnce(new Uint8Array([1]))
      .mockReturnValueOnce(new Uint8Array([2]))
    const encoder = amrChunkedEncoderDefinition.create()

    expect(encoder.feedFrame(1, 8000, [new Int16Array([])])).toBeNull()
    const first = encoder.feedFrame(1, 8000, [new Int16Array([10, 11, 12])])
    const second = encoder.flush()

    expect(first).toEqual(new Uint8Array([35, 33, 65, 77, 82, 10, 1]))
    expect(second).toEqual(new Uint8Array([2]))
    expect(encode).toHaveBeenNthCalledWith(1, new Int16Array([10, 11]))
    expect(encode).toHaveBeenNthCalledWith(2, new Int16Array([12, 0]))
  })

  it("resamples chunked input and releases the encoder on dispose", () => {
    resample.mockReturnValueOnce(snapshot([new Int16Array([1, 2, 3, 4])], 8000))
    encode.mockReturnValueOnce(new Uint8Array([9]))
    const encoder = amrChunkedEncoderDefinition.create({ bandMode: "wb" })

    const result = encoder.feedFrame(2, 48000, [
      new Int16Array([1, 2]),
      new Int16Array([3, 4]),
    ])

    expect(resample).toHaveBeenCalledTimes(1)
    expect(createAmrEncoder).toHaveBeenCalledWith({ bandMode: "wb" })
    expect(result).toEqual(
      new Uint8Array([35, 33, 65, 77, 82, 45, 87, 66, 10, 9])
    )

    encoder.dispose()
    expect(free).toHaveBeenCalledTimes(1)
  })

  it("exports AMR snapshots with padding, first-channel selection, and optional resampling", () => {
    encode
      .mockReturnValueOnce(new Uint8Array([5]))
      .mockReturnValueOnce(new Uint8Array([6]))
    resample.mockReturnValueOnce(snapshot([new Int16Array([7, 8, 9])], 8000))

    const result = exportAmrSnapshot(
      snapshot([new Int16Array([1, 2]), new Int16Array([99, 100])], 16000),
      { bandMode: "nb" }
    )

    expect(resample).toHaveBeenCalledTimes(1)
    expect(result.mimeType).toBe("audio/amr")
    expect(result.channels).toBe(1)
    expect(result.sampleRate).toBe(8000)
    expect(Array.from(result.data)).toEqual([35, 33, 65, 77, 82, 10, 5, 6])
    expect(encode).toHaveBeenNthCalledWith(1, new Int16Array([7, 8]))
    expect(encode).toHaveBeenNthCalledWith(2, new Int16Array([9, 0]))
    expect(free).toHaveBeenCalledTimes(1)
  })
})
