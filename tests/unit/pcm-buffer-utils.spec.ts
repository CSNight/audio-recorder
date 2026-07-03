import { describe, expect, it } from "vitest"
import {
  getFrameBytes,
  mergeChannelChunks,
} from "../../src/buffer/pcm-buffer-utils"
import type { AudioFrame } from "../../src"

function makeFrame(planar: Int16Array[], sampleRate = 16000): AudioFrame {
  return {
    planar,
    sampleRate,
    channels: planar.length,
    durationMs: ((planar[0]?.length ?? 0) / sampleRate) * 1000,
    timestamp: 0,
  }
}

describe("getFrameBytes", () => {
  it("单声道：返回单个 channel 的 byteLength", () => {
    const frame = makeFrame([new Int16Array(4)])
    // Int16Array(4) → 4 × 2 bytes = 8
    expect(getFrameBytes(frame)).toBe(8)
  })

  it("立体声：返回所有 channel byteLength 之和", () => {
    const frame = makeFrame([new Int16Array(8), new Int16Array(8)])
    // 2 × (8 × 2) = 32
    expect(getFrameBytes(frame)).toBe(32)
  })

  it("三声道混合长度：正确求和", () => {
    const frame = makeFrame([
      new Int16Array(2),
      new Int16Array(4),
      new Int16Array(6),
    ])
    // (2 + 4 + 6) × 2 = 24
    expect(getFrameBytes(frame)).toBe(24)
  })

  it("空帧（0 帧数）：返回 0", () => {
    const frame = makeFrame([new Int16Array(0)])
    expect(getFrameBytes(frame)).toBe(0)
  })

  it("零声道帧：返回 0", () => {
    const frame: AudioFrame = {
      planar: [],
      sampleRate: 16000,
      channels: 0,
      durationMs: 0,
      timestamp: 0,
    }
    expect(getFrameBytes(frame)).toBe(0)
  })

  it("channels 声明多于 planar 数组实际长度时，缺失 channel 按 0 计", () => {
    // channels=2 但 planar 只有 1 个 → planar[1] 为 undefined → ?? 0 分支
    const frame: AudioFrame = {
      planar: [new Int16Array(4)],
      sampleRate: 16000,
      channels: 2,
      durationMs: 0.25,
      timestamp: 0,
    }
    // 只有 channel 0 贡献 4×2=8 bytes，channel 1 缺失贡献 0
    expect(getFrameBytes(frame)).toBe(8)
  })
})

describe("mergeChannelChunks", () => {
  it("空数组返回长度为 0 的 Int16Array", () => {
    const result = mergeChannelChunks([])
    expect(result).toBeInstanceOf(Int16Array)
    expect(result.length).toBe(0)
  })

  it("单个 chunk：原样返回内容", () => {
    const chunk = new Int16Array([1, 2, 3, 4])
    const result = mergeChannelChunks([chunk])
    expect(Array.from(result)).toEqual([1, 2, 3, 4])
  })

  it("两个 chunk：顺序拼接", () => {
    const a = new Int16Array([10, 20])
    const b = new Int16Array([30, 40, 50])
    const result = mergeChannelChunks([a, b])
    expect(Array.from(result)).toEqual([10, 20, 30, 40, 50])
  })

  it("三个 chunk：正确拼接", () => {
    const chunks = [
      new Int16Array([1, 2]),
      new Int16Array([3]),
      new Int16Array([4, 5, 6]),
    ]
    const result = mergeChannelChunks(chunks)
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it("chunk 中含边界值（Int16 min/max）", () => {
    const a = new Int16Array([-32768, 32767])
    const b = new Int16Array([0, -1])
    const result = mergeChannelChunks([a, b])
    expect(Array.from(result)).toEqual([-32768, 32767, 0, -1])
  })

  it("结果总长度等于所有 chunk 长度之和", () => {
    const chunks = Array.from({ length: 5 }, (_, i) => new Int16Array(i + 1))
    const result = mergeChannelChunks(chunks)
    expect(result.length).toBe(1 + 2 + 3 + 4 + 5)
  })
})
