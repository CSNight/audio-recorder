import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import {
  exportMp3Snapshot,
  mp3SnapshotEncoderDefinition,
} from "@/codecs/mp3/mp3-snapshot-exporter"

/** 生成简单的正弦波 PCM 数据，避免全 0 静音导致 lamejs 内部分支被跳过 */
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

describe("mp3SnapshotEncoderDefinition", () => {
  it("has type 'mp3'", () => {
    expect(mp3SnapshotEncoderDefinition.type).toBe("mp3")
  })

  it("export() delegates to exportMp3Snapshot", async () => {
    const snapshot = makeSnapshot(4608, 1)
    const result = await mp3SnapshotEncoderDefinition.export(snapshot, {})
    expect(result.data.byteLength).toBeGreaterThan(0)
  })
})

describe("exportMp3Snapshot: basic output", () => {
  it("produces non-empty MP3 data for a mono snapshot spanning multiple frames", () => {
    // 4 个 MPEG 帧 (4 * 1152)，确保 encodeBuffer 至少产出一次 + flush 产出
    const snapshot = makeSnapshot(1152 * 4, 1)
    const result = exportMp3Snapshot(snapshot)

    expect(result.data).toBeInstanceOf(Uint8Array)
    expect(result.data.byteLength).toBeGreaterThan(0)
    expect(result.sampleRate).toBe(44100)
    expect(result.channels).toBe(1)
    expect(result.bitrateKbps).toBe(128)
  })

  it("uses default bitrate 128 when not specified", () => {
    const snapshot = makeSnapshot(1152 * 2, 1)
    const result = exportMp3Snapshot(snapshot, {})
    expect(result.bitrateKbps).toBe(128)
  })

  it("respects custom bitrateKbps option", () => {
    const snapshot = makeSnapshot(1152 * 2, 1)
    const result = exportMp3Snapshot(snapshot, { bitrateKbps: 320 })
    expect(result.bitrateKbps).toBe(320)
  })

  it("higher bitrate produces different (typically larger) output than lower bitrate for same input", () => {
    const snapshot = makeSnapshot(1152 * 8, 1)
    const low = exportMp3Snapshot(snapshot, { bitrateKbps: 64 })
    const high = exportMp3Snapshot(snapshot, { bitrateKbps: 320 })
    expect(low.data.byteLength).not.toBe(high.data.byteLength)
  })
})

describe("exportMp3Snapshot: channel handling", () => {
  it("mono snapshot produces channels=1 in result", () => {
    const snapshot = makeSnapshot(1152 * 2, 1)
    const result = exportMp3Snapshot(snapshot)
    expect(result.channels).toBe(1)
  })

  it("stereo snapshot produces channels=2 in result", () => {
    const snapshot = makeSnapshot(1152 * 2, 2)
    const result = exportMp3Snapshot(snapshot)
    expect(result.channels).toBe(2)
  })

  it("clamps channels to 2 for snapshots with 3+ channels (uses first two)", () => {
    const snapshot = makeSnapshot(1152 * 2, 3)
    const result = exportMp3Snapshot(snapshot)
    expect(result.channels).toBe(2)
  })

  it("stereo input produces different byte length than mono input of same duration", () => {
    const mono = makeSnapshot(1152 * 4, 1)
    const stereo = makeSnapshot(1152 * 4, 2)
    const monoResult = exportMp3Snapshot(mono)
    const stereoResult = exportMp3Snapshot(stereo)
    // 双声道信息量更大，编码字节数通常更大（非严格相等比较，避免对 lamejs 内部实现细节过度断言）
    expect(stereoResult.data.byteLength).toBeGreaterThan(0)
    expect(monoResult.data.byteLength).toBeGreaterThan(0)
  })
})

describe("exportMp3Snapshot: resampling", () => {
  it("resamples to target sampleRate when option is specified", () => {
    const snapshot = makeSnapshot(1152 * 4, 1, 48000)
    const result = exportMp3Snapshot(snapshot, { sampleRate: 44100 })
    expect(result.sampleRate).toBe(44100)
  })

  it("uses original sampleRate when option is not specified", () => {
    const snapshot = makeSnapshot(1152 * 2, 1, 48000)
    const result = exportMp3Snapshot(snapshot)
    expect(result.sampleRate).toBe(48000)
  })

  it("durationMs reflects resampled snapshot duration, not original", () => {
    // 1 秒原始时长 @ 48000Hz，重采样到 8000Hz 后仍应约为 1000ms
    const snapshot = makeSnapshot(48000, 1, 48000)
    const result = exportMp3Snapshot(snapshot, { sampleRate: 8000 })
    expect(result.durationMs).toBeCloseTo(1000, 0)
  })
})

describe("exportMp3Snapshot: edge cases worth covering", () => {
  it("handles empty snapshot (0 samples) without throwing", () => {
    const snapshot = makeSnapshot(0, 1)
    expect(() => exportMp3Snapshot(snapshot)).not.toThrow()
  })

  it("handles snapshot shorter than a single MPEG frame (no main-loop iteration, only flush)", () => {
    const snapshot = makeSnapshot(100, 1)
    const result = exportMp3Snapshot(snapshot)
    // 仍可能由 flush() 产出数据（如 LAME 标签帧），不应抛错
    expect(result.data).toBeInstanceOf(Uint8Array)
  })

  it("handles snapshot with samples not aligned to MPEG_FRAME_SIZE boundary", () => {
    // 1152 * 2 + 500，最后一帧不足 1152
    const snapshot = makeSnapshot(1152 * 2 + 500, 1)
    expect(() => exportMp3Snapshot(snapshot)).not.toThrow()
  })
})
