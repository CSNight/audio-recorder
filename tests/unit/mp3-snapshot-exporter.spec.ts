import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PcmBufferSnapshot } from "../../src/buffer/types"
import type { Mp3WasmEncoderHandle } from "../../src/codecs/mp3/types"

const preloadMp3Module = vi.fn(async () => {})
const createMp3Encoder =
  vi.fn<(options: unknown, channels: 1 | 2) => Mp3WasmEncoderHandle>()

const mockEncode =
  vi.fn<
    (left: Int16Array, right: Int16Array, sampleCount: number) => Uint8Array
  >()
const mockFlush = vi.fn<() => Uint8Array>()
const mockFree = vi.fn<() => void>()

vi.mock("../../src/codecs/mp3/mp3-wasm-api", () => ({
  preloadMp3Module,
  createMp3Encoder,
  resolveMp3EncoderOptions: (
    options: Record<string, unknown> = {},
    sampleRate: number,
    channels: number
  ) => ({
    bitrateKbps: (options.bitrateKbps as number | undefined) ?? 128,
    mode: (options.mode as string | undefined) ?? "cbr",
    vbrQuality: (options.vbrQuality as number | undefined) ?? 4,
    sampleRate: ((options.sampleRate as number | undefined) ?? sampleRate) as
      | 8000
      | 11025
      | 12000
      | 16000
      | 22050
      | 24000
      | 32000
      | 44100
      | 48000,
    channelMode:
      (options.channelMode as string | undefined) ??
      (channels > 1 ? "stereo" : "mono"),
    quality: (options.quality as number | undefined) ?? 2,
  }),
}))

const { exportMp3Snapshot, mp3ExportEncoder } =
  await import("../../src/codecs/mp3/mp3-snapshot-exporter")

function sine(length: number, freq = 440, sampleRate = 44100): Int16Array {
  const out = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    out[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 16000)
  }
  return out
}

function makeSnapshot(
  samplesPerChannel: number,
  channels = 1,
  sampleRate = 44100
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
  mockEncode.mockReturnValue(new Uint8Array([1, 2, 3]))
  mockFlush.mockReturnValue(new Uint8Array([4, 5]))
  createMp3Encoder.mockImplementation(
    (options: unknown, channels: 1 | 2) =>
      ({
        sampleRate: (options as { sampleRate: 44100 | 48000 | 8000 })
          .sampleRate,
        channels,
        encode: mockEncode,
        flush: mockFlush,
        free: mockFree,
      }) as Mp3WasmEncoderHandle
  )
})

describe("mp3ExportEncoder", () => {
  it("has type 'mp3' and exposes preload", async () => {
    expect(mp3ExportEncoder.type).toBe("mp3")
    expect(mp3ExportEncoder.preload).toBe(preloadMp3Module)
    await mp3ExportEncoder.preload?.()
    expect(preloadMp3Module).toHaveBeenCalledTimes(1)
  })

  it("export() delegates to exportMp3Snapshot", () => {
    // 直接调用 mp3ExportEncoder.export()，覆盖 line 164 的箭头函数
    const snapshot = makeSnapshot(1152, 1)
    const result = mp3ExportEncoder.export(snapshot, {})
    expect(result.sampleRate).toBe(44100)
    expect(result.channels).toBe(1)
    expect(result.data).toBeInstanceOf(Uint8Array)
  })
})

describe("exportMp3Snapshot", () => {
  it("produces merged MP3 data for mono input", () => {
    const result = exportMp3Snapshot(makeSnapshot(1152 * 2, 1))
    expect(result.sampleRate).toBe(44100)
    expect(result.channels).toBe(1)
    expect(result.bitrateKbps).toBe(128)
    expect(Array.from(result.data)).toEqual([1, 2, 3, 1, 2, 3, 4, 5])
  })

  it("passes explicit CBR settings to the encoder", () => {
    exportMp3Snapshot(makeSnapshot(1152, 1), {
      bitrateKbps: 192,
      mode: "cbr",
      quality: 4,
    })
    expect(createMp3Encoder).toHaveBeenCalledWith(
      expect.objectContaining({ bitrateKbps: 192, mode: "cbr", quality: 4 }),
      1
    )
  })

  it("passes VBR settings to the encoder", () => {
    exportMp3Snapshot(makeSnapshot(1152, 2), {
      mode: "vbr",
      vbrQuality: 1,
      channelMode: "joint-stereo",
    })
    expect(createMp3Encoder).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "vbr",
        vbrQuality: 1,
        channelMode: "joint-stereo",
      }),
      2
    )
  })

  it("defaults to stereo when input has more than one channel", () => {
    exportMp3Snapshot(makeSnapshot(1152, 2))
    expect(createMp3Encoder).toHaveBeenCalledWith(
      expect.objectContaining({ channelMode: "stereo" }),
      2
    )
  })

  it("uses the first two channels for stereo-oriented output", () => {
    const snapshot = makeSnapshot(8, 3)
    exportMp3Snapshot(snapshot, { channelMode: "stereo" })
    const [left, right, sampleCount] = mockEncode.mock.calls[0]!
    expect(sampleCount).toBe(8)
    expect(left).toEqual(snapshot.planar[0])
    expect(right).toEqual(snapshot.planar[1])
  })

  it("downmixes to mono when requested", () => {
    const snapshot: PcmBufferSnapshot = {
      sampleRate: 44100,
      channels: 3,
      frameCount: 1,
      durationMs: 10,
      planar: [
        new Int16Array([10, 10, 10, 10]),
        new Int16Array([20, 20, 20, 20]),
        new Int16Array([40, 40, 40, 40]),
      ],
    }
    exportMp3Snapshot(snapshot, { channelMode: "mono" })
    const [left, right] = mockEncode.mock.calls[0]!
    expect(Array.from(left as Int16Array)).toEqual([23, 23, 23, 23])
    expect(Array.from(right as Int16Array)).toEqual([23, 23, 23, 23])
  })

  it("resamples to the requested sampleRate", () => {
    const result = exportMp3Snapshot(makeSnapshot(4800, 1, 48000), {
      sampleRate: 8000,
    })
    expect(result.sampleRate).toBe(8000)
    expect(createMp3Encoder).toHaveBeenCalledWith(
      expect.objectContaining({ sampleRate: 8000 }),
      1
    )
  })

  it("handles empty input without throwing", () => {
    const result = exportMp3Snapshot(makeSnapshot(0, 1))
    expect(result.data).toBeInstanceOf(Uint8Array)
  })

  it("always frees the encoder", () => {
    exportMp3Snapshot(makeSnapshot(1152, 1))
    expect(mockFree).toHaveBeenCalledTimes(1)
  })

  it("跳过 encode 返回空字节的帧（encoded.length === 0 分支）", () => {
    // 第一帧返回空，第二帧返回数据 → 只有第二帧 + flush 进入 chunks
    mockEncode
      .mockReturnValueOnce(new Uint8Array(0)) // 第一帧：空，不 push
      .mockReturnValue(new Uint8Array([7, 8, 9])) // 后续帧：有数据
    mockFlush.mockReturnValue(new Uint8Array(0)) // flush 也空

    const result = exportMp3Snapshot(makeSnapshot(1152 * 2, 1))
    // 第一帧跳过，第二帧 [7,8,9]，flush 空 → data = [7,8,9]
    expect(Array.from(result.data)).toEqual([7, 8, 9])
  })
})
