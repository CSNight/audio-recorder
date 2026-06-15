import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import { resamplePlanarPcm, resamplePlanarPcmHQ, lowPassFilter } from "@/utils/resample"

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 生成单频正弦波 Int16 PCM */
function makeSine(
  frequencyHz: number,
  sampleRate: number,
  durationMs: number,
  amplitude = 16000
): Int16Array {
  const length = Math.round((sampleRate * durationMs) / 1000)
  const arr = new Int16Array(length)
  for (let i = 0; i < length; i++) {
    arr[i] = Math.round(amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate))
  }
  return arr
}

/** 计算 Int16Array 的 RMS（均方根） */
function rms(arr: Int16Array): number {
  if (arr.length === 0) return 0
  let sum = 0
  for (const v of arr) sum += v * v
  return Math.sqrt(sum / arr.length)
}

function makeSnapshot(
  planar: Int16Array[],
  sampleRate: number,
  channels: 1 | 2 = 1
): PcmBufferSnapshot {
  const frameCount = planar[0]?.length ?? 0
  return {
    sampleRate,
    channels,
    frameCount,
    durationMs: (frameCount / sampleRate) * 1000,
    planar,
  }
}

// ---------------------------------------------------------------------------
// resamplePlanarPcm（原始线性插值版）
// ---------------------------------------------------------------------------

describe("resamplePlanarPcm", () => {
  it("keeps planar PCM unchanged when the sampleRate does not change", () => {
    const snapshot = makeSnapshot([new Int16Array([0, 1000, -1000, 500])], 16_000)
    const result = resamplePlanarPcm(snapshot, 16_000)

    expect(result.sampleRate).toBe(16_000)
    expect(Array.from(result.planar[0] ?? [])).toEqual([0, 1000, -1000, 500])
  })

  it("downsamples planar PCM and preserves stereo channel layout", () => {
    const snapshot = makeSnapshot(
      [
        new Int16Array([0, 1000, 2000, 3000, 4000, 5000]),
        new Int16Array([0, -1000, -2000, -3000, -4000, -5000]),
      ],
      48_000,
      2
    )

    const result = resamplePlanarPcm(snapshot, 16_000)

    expect(result.sampleRate).toBe(16_000)
    expect(result.channels).toBe(2)
    expect(Array.from(result.planar[0] ?? [])).toEqual([0, 3000])
    expect(Array.from(result.planar[1] ?? [])).toEqual([0, -3000])
  })

  it("rejects non-positive target sampleRate values", () => {
    const snapshot = makeSnapshot([new Int16Array([0, 1000])], 16_000)
    expect(() => resamplePlanarPcm(snapshot, 0)).toThrow(
      "Resample target sampleRate must be positive, received 0."
    )
  })

  it("upsamples correctly (2× upsample, linear interpolation)", () => {
    const snapshot = makeSnapshot([new Int16Array([0, 1000, 2000])], 8_000)
    const result = resamplePlanarPcm(snapshot, 16_000)

    expect(result.sampleRate).toBe(16_000)
    // 输出长度应为输入的两倍（允许 ±1 误差）
    expect(result.planar[0]?.length).toBeGreaterThanOrEqual(5)
    expect(result.planar[0]?.length).toBeLessThanOrEqual(6)
  })

  it("handles empty channel gracefully", () => {
    const snapshot = makeSnapshot([new Int16Array(0)], 48_000)
    const result = resamplePlanarPcm(snapshot, 16_000)

    expect(result.planar[0]?.length).toBe(0)
    expect(result.durationMs).toBe(0)
  })

  it("computes durationMs accurately after downsampling", () => {
    // 48000 Hz, 480 帧 → 10 ms；降到 16000 → 160 帧，仍 10 ms
    const input = new Int16Array(480).fill(100)
    const snapshot = makeSnapshot([input], 48_000)
    const result = resamplePlanarPcm(snapshot, 16_000)

    expect(result.durationMs).toBeCloseTo(10, 0)
  })
})

// ---------------------------------------------------------------------------
// lowPassFilter
// ---------------------------------------------------------------------------

describe("lowPassFilter", () => {
  it("preserves DC (全零频) 信号，直流增益 ≈ 1", () => {
    const dc = new Int16Array(256).fill(10000)
    const filtered = lowPassFilter(dc, 48_000, 8_000, 32)

    // 中间部分（排除两端边界效应）应接近原值
    const mid = filtered.slice(64, 192)
    for (const v of mid) {
      expect(Math.abs(v - 10000)).toBeLessThan(200) // ±2%
    }
  })

  it("衰减截止频率以上的正弦波（混叠频率）", () => {
    const sampleRate = 48_000
    const cutoffHz = 8_000
    // 远高于截止的频率应被大幅衰减
    const highFreq = makeSine(18_000, sampleRate, 100) // 18 kHz >> 8 kHz
    const filtered = lowPassFilter(highFreq, sampleRate, cutoffHz, 64)

    const inputRms = rms(highFreq)
    const outputRms = rms(filtered)

    // 高频信号应被衰减到原来的 20% 以下
    expect(outputRms).toBeLessThan(inputRms * 0.2)
  })

  it("通带内的低频信号几乎不衰减", () => {
    const sampleRate = 48_000
    const cutoffHz = 8_000
    // 远低于截止的频率应几乎无损通过
    const lowFreq = makeSine(1_000, sampleRate, 200) // 1 kHz << 8 kHz
    const filtered = lowPassFilter(lowFreq, sampleRate, cutoffHz, 64)

    // 排除边界（halfTaps = 64 样本）
    const inputMid = lowFreq.slice(128, lowFreq.length - 128)
    const outputMid = filtered.slice(128, filtered.length - 128)

    const inputRmsMid = rms(inputMid)
    const outputRmsMid = rms(outputMid)

    // 通带增益应接近 1（允许 ±10% 误差）
    expect(outputRmsMid / inputRmsMid).toBeGreaterThan(0.9)
    expect(outputRmsMid / inputRmsMid).toBeLessThan(1.1)
  })

  it("返回长度与输入一致", () => {
    const input = makeSine(1000, 48_000, 50)
    const filtered = lowPassFilter(input, 48_000, 8_000, 64)
    expect(filtered.length).toBe(input.length)
  })

  it("空输入返回空数组", () => {
    const filtered = lowPassFilter(new Int16Array(0), 48_000, 8_000, 32)
    expect(filtered.length).toBe(0)
  })

  it("halfTaps < 1 时抛出错误", () => {
    const input = makeSine(1000, 48_000, 10)
    expect(() => lowPassFilter(input, 48_000, 8_000, 0)).toThrow(
      "lowPassFilter halfTaps must be at least 1, received 0."
    )
  })

  it("cutoffHz <= 0 时抛出错误", () => {
    const input = makeSine(1000, 48_000, 10)
    expect(() => lowPassFilter(input, 48_000, 0, 32)).toThrow(
      "lowPassFilter cutoffHz must be within"
    )
  })

  it("cutoffHz >= sampleRate/2 时抛出错误（混叠域）", () => {
    const input = makeSine(1000, 48_000, 10)
    expect(() => lowPassFilter(input, 48_000, 24_000, 32)).toThrow(
      "lowPassFilter cutoffHz must be within"
    )
  })

  it("所有输出值都在 Int16 范围内", () => {
    const input = makeSine(440, 44_100, 100, 32767)
    const filtered = lowPassFilter(input, 44_100, 10_000, 32)
    for (const v of filtered) {
      expect(v).toBeGreaterThanOrEqual(-32768)
      expect(v).toBeLessThanOrEqual(32767)
    }
  })
})

// ---------------------------------------------------------------------------
// resamplePlanarPcmHQ（带低通滤波的保真降采样）
// ---------------------------------------------------------------------------

describe("resamplePlanarPcmHQ", () => {
  it("同采样率时原样返回（无滤波）", () => {
    const data = new Int16Array([0, 1000, -1000, 500])
    const snapshot = makeSnapshot([data], 16_000)
    const result = resamplePlanarPcmHQ(snapshot, 16_000)

    expect(result.sampleRate).toBe(16_000)
    expect(Array.from(result.planar[0] ?? [])).toEqual([0, 1000, -1000, 500])
  })

  it("拒绝非正目标采样率", () => {
    const snapshot = makeSnapshot([new Int16Array([0, 1000])], 16_000)
    expect(() => resamplePlanarPcmHQ(snapshot, -1)).toThrow(
      "Resample target sampleRate must be positive, received -1."
    )
  })

  it("降采样后输出采样率和时长正确", () => {
    const input = new Int16Array(480).fill(1000)
    const snapshot = makeSnapshot([input], 48_000)
    const result = resamplePlanarPcmHQ(snapshot, 16_000)

    expect(result.sampleRate).toBe(16_000)
    expect(result.durationMs).toBeCloseTo(10, 0)
  })

  it("降采样后高于奈奎斯特频率的成分被大幅衰减（抗混叠）", () => {
    // 48000→16000 降采样，混叠频率为 8000 Hz
    // 注入 12000 Hz 正弦：在目标域无法表示，不做 HQ 时会折回；做了之后应被衰减
    const sampleRate = 48_000
    const targetRate = 16_000
    const aliasingFreq = 12_000 // > targetRate/2

    const highFreqSignal = makeSine(aliasingFreq, sampleRate, 200, 16000)
    const snapshot = makeSnapshot([highFreqSignal], sampleRate)

    const resultHQ = resamplePlanarPcmHQ(snapshot, targetRate, 64)
    const resultBasic = resamplePlanarPcm(snapshot, targetRate)

    const rmsHQ = rms(resultHQ.planar[0]!)
    const rmsBasic = rms(resultBasic.planar[0]!)

    // HQ 输出的能量应远小于基础线性插值（混叠被过滤）
    expect(rmsHQ).toBeLessThan(rmsBasic * 0.5)
  })

  it("升采样时行为与 resamplePlanarPcm 一致（无损通带）", () => {
    // 8000→16000 升采样，HQ 和 basic 结果应接近
    const input = makeSine(1_000, 8_000, 50, 8000)
    const snapshot = makeSnapshot([input], 8_000)

    const resultHQ = resamplePlanarPcmHQ(snapshot, 16_000)
    const resultBasic = resamplePlanarPcm(snapshot, 16_000)

    expect(resultHQ.planar[0]?.length).toBe(resultBasic.planar[0]?.length)

    // 两者 RMS 应相近（± 5%）
    const rmsHQVal = rms(resultHQ.planar[0]!)
    const rmsBasicVal = rms(resultBasic.planar[0]!)
    expect(Math.abs(rmsHQVal - rmsBasicVal) / (rmsBasicVal || 1)).toBeLessThan(0.05)
  })

  it("保留立体声通道数", () => {
    const ch1 = makeSine(440, 48_000, 50)
    const ch2 = makeSine(880, 48_000, 50)
    const snapshot = makeSnapshot([ch1, ch2], 48_000, 2)

    const result = resamplePlanarPcmHQ(snapshot, 16_000)

    expect(result.channels).toBe(2)
    expect(result.planar.length).toBe(2)
  })

  it("空通道降采样不崩溃", () => {
    const snapshot = makeSnapshot([new Int16Array(0)], 48_000)
    const result = resamplePlanarPcmHQ(snapshot, 16_000)

    expect(result.planar[0]?.length).toBe(0)
    expect(result.durationMs).toBe(0)
  })

  it("输出所有样本在 Int16 范围内", () => {
    const input = makeSine(1000, 48_000, 100, 32767)
    const snapshot = makeSnapshot([input], 48_000)
    const result = resamplePlanarPcmHQ(snapshot, 16_000)

    for (const v of result.planar[0] ?? []) {
      expect(v).toBeGreaterThanOrEqual(-32768)
      expect(v).toBeLessThanOrEqual(32767)
    }
  })
})
