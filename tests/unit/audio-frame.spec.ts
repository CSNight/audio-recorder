import { describe, expect, it } from "vitest"
import {
  createAudioFrame,
  resolveChannelCount,
  toInt16Sample,
} from "@/utils/audio-frame"

describe("audio frame utilities", () => {
  it("clamps float samples to int16", () => {
    // 先锁定最底层样本转换规则，避免上层 frame 断言掩盖数值映射错误。
    expect(toInt16Sample(-2)).toBe(-32768)
    expect(toInt16Sample(-0.5)).toBe(-16384)
    expect(toInt16Sample(0.5)).toBe(16384)
    expect(toInt16Sample(2)).toBe(32767)
  })

  it("rounds boundary float samples consistently around zero", () => {
    expect(toInt16Sample(-1)).toBe(-32768)
    expect(toInt16Sample(0)).toBe(0)
    expect(toInt16Sample(1)).toBe(32767)
  })

  it("creates stereo frames with duration metadata", () => {
    // Phase 1 的核心输出就是带时长元数据的 Int16 PCM 帧，这里直接校验最终结构。
    const frame = createAudioFrame(
      [
        new Float32Array([0, 0.25, -0.25, 1]),
        new Float32Array([0, -0.25, 0.25, -1]),
      ],
      8_000,
      123
    )

    expect(frame.channels).toBe(2)
    expect(frame.sampleRate).toBe(8_000)
    expect(frame.timestamp).toBe(123)
    expect(frame.durationMs).toBe(0.5)
    expect(Array.from(frame.planar[0] ?? [])).toEqual([0, 8192, -8192, 32767])
    expect(Array.from(frame.planar[1] ?? [])).toEqual([0, -8192, 8192, -32768])
  })

  it("supports arbitrary channel counts based on hardware capabilities", () => {
    // 新行为：支持任意正整数声道数，无效输入时回退到单声道
    expect(resolveChannelCount(undefined)).toBe(1)
    expect(resolveChannelCount(0)).toBe(1)
    expect(resolveChannelCount(1)).toBe(1)
    expect(resolveChannelCount(2)).toBe(2)
    expect(resolveChannelCount(6)).toBe(6) // 支持多声道（如 5.1）
    expect(resolveChannelCount(8)).toBe(8) // 支持多声道（如 7.1）
  })

  it("creates empty mono frames when no channel data is provided", () => {
    const frame = createAudioFrame([], 16_000, 42)

    expect(frame.channels).toBe(1)
    expect(frame.sampleRate).toBe(16_000)
    expect(frame.timestamp).toBe(42)
    expect(frame.durationMs).toBe(0)
    expect(frame.planar).toEqual([])
  })

  it("preserves all channels from multi-channel input", () => {
    const frame = createAudioFrame(
      [
        new Float32Array([0.25]),
        new Float32Array([-0.25]),
        new Float32Array([1]),
      ],
      16_000,
      7
    )

    expect(frame.channels).toBe(3) // 保留所有3个声道
    expect(frame.planar).toHaveLength(3)
    expect(Array.from(frame.planar[0] ?? [])).toEqual([8192])
    expect(Array.from(frame.planar[1] ?? [])).toEqual([-8192])
    expect(Array.from(frame.planar[2] ?? [])).toEqual([32767])
  })
})
