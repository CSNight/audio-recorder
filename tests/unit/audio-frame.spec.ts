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

  it("resolves unsupported channel counts to the supported range", () => {
    // 当前库只承诺单/双声道，超出范围时必须稳定收敛，避免下游出现分支爆炸。
    expect(resolveChannelCount(undefined)).toBe(1)
    expect(resolveChannelCount(0)).toBe(1)
    expect(resolveChannelCount(1)).toBe(1)
    expect(resolveChannelCount(2)).toBe(2)
    expect(resolveChannelCount(6)).toBe(1)
  })
})
