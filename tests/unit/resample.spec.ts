import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import { resample, lowPassFilter } from "@/utils/resample"

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
// resample — 通用行为
// ---------------------------------------------------------------------------

describe("resample (common)", () => {
  it("同采样率时原样复制，不修改数据", () => {
    const snapshot = makeSnapshot([new Int16Array([0, 1000, -1000, 500])], 16_000)
    const result = resample(snapshot, 16_000)

    expect(result.sampleRate).toBe(16_000)
    expect(result.channels).toBe(1)
    expect(Array.from(result.planar[0] ?? [])).toEqual([0, 1000, -1000, 500])
  })

  it("拒绝非正目标采样率", () => {
    const snapshot = makeSnapshot([new Int16Array([0, 1000])], 16_000)
    expect(() => resample(snapshot, 0)).toThrow(
      "Resample target sampleRate must be positive, received 0."
    )
    expect(() => resample(snapshot, -1)).toThrow(
      "Resample target sampleRate must be positive, received -1."
    )
  })

  it("拒绝无通道的快照", () => {
    const snapshot = makeSnapshot([], 16_000)
    expect(() => resample(snapshot, 8_000)).toThrow(
      "Resample snapshot must contain at least one channel."
    )
  })

  it("保留立体声通道数和布局", () => {
    const ch1 = new Int16Array([0, 1000, 2000, 3000, 4000, 5000])
    const ch2 = new Int16Array([0, -1000, -2000, -3000, -4000, -5000])
    const snapshot = makeSnapshot([ch1, ch2], 48_000, 2)
    const result = resample(snapshot, 16_000)

    expect(result.channels).toBe(2)
    expect(result.planar.length).toBe(2)
  })

  it("所有输出样本在 Int16 范围内", () => {
    const input = makeSine(1000, 48_000, 100, 32767)
    const snapshot = makeSnapshot([input], 48_000)
    const result = resample(snapshot, 16_000)

    for (const v of result.planar[0] ?? []) {
      expect(v).toBeGreaterThanOrEqual(-32768)
      expect(v).toBeLessThanOrEqual(32767)
    }
  })

  it("durationMs 在降采样后保持准确", () => {
    // 48000 Hz, 480 帧 → 10 ms；降到 16000 → 160 帧，仍 10 ms
    const input = new Int16Array(480).fill(100)
    const snapshot = makeSnapshot([input], 48_000)
    const result = resample(snapshot, 16_000)

    expect(result.durationMs).toBeCloseTo(10, 0)
  })
})

// ---------------------------------------------------------------------------
// 升采样 LQ（isHQ = false）
// ---------------------------------------------------------------------------

describe("resample — 升采样 LQ (isHQ=false)", () => {
  it("2× 升采样输出长度约为输入两倍", () => {
    const snapshot = makeSnapshot([new Int16Array([0, 1000, 2000])], 8_000)
    const result = resample(snapshot, 16_000, { isHQ: false })

    expect(result.sampleRate).toBe(16_000)
    expect(result.planar[0]?.length).toBeGreaterThanOrEqual(5)
    expect(result.planar[0]?.length).toBeLessThanOrEqual(6)
  })

  it("空通道升采样不崩溃", () => {
    const snapshot = makeSnapshot([new Int16Array(0)], 8_000)
    const result = resample(snapshot, 16_000, { isHQ: false })

    expect(result.planar[0]?.length).toBe(0)
    expect(result.durationMs).toBe(0)
  })

  it("低频正弦升采样后 RMS 接近原始信号", () => {
    const input = makeSine(1_000, 8_000, 100, 8000)
    const snapshot = makeSnapshot([input], 8_000)
    const result = resample(snapshot, 16_000, { isHQ: false })

    const rmsIn = rms(input)
    const rmsOut = rms(result.planar[0]!)
    // 升采样不应大幅改变信号能量（允许 ±20%）
    expect(rmsOut / rmsIn).toBeGreaterThan(0.8)
    expect(rmsOut / rmsIn).toBeLessThan(1.2)
  })

  it("默认 options（isHQ 未设置）走 LQ 路径，与 isHQ=false 结果相同", () => {
    const input = makeSine(500, 8_000, 50, 8000)
    const snapshot = makeSnapshot([input], 8_000)
    const resultDefault = resample(snapshot, 16_000)
    const resultLQ = resample(snapshot, 16_000, { isHQ: false })

    expect(Array.from(resultDefault.planar[0] ?? [])).toEqual(
      Array.from(resultLQ.planar[0] ?? [])
    )
  })
})

// ---------------------------------------------------------------------------
// 升采样 HQ（isHQ = true，Lanczos-3 sinc）
// ---------------------------------------------------------------------------

describe("resample — 升采样 HQ (isHQ=true)", () => {
  it("2× 升采样输出长度约为输入两倍", () => {
    const snapshot = makeSnapshot([new Int16Array([0, 1000, 2000])], 8_000)
    const result = resample(snapshot, 16_000, { isHQ: true })

    expect(result.sampleRate).toBe(16_000)
    expect(result.planar[0]?.length).toBeGreaterThanOrEqual(5)
    expect(result.planar[0]?.length).toBeLessThanOrEqual(6)
  })

  it("空通道升采样 HQ 不崩溃", () => {
    const snapshot = makeSnapshot([new Int16Array(0)], 8_000)
    const result = resample(snapshot, 16_000, { isHQ: true })

    expect(result.planar[0]?.length).toBe(0)
    expect(result.durationMs).toBe(0)
  })

  it("Lanczos HQ 升采样与 LQ 升采样输出长度一致", () => {
    const input = makeSine(1_000, 8_000, 50, 8000)
    const snapshot = makeSnapshot([input], 8_000)

    const resultHQ = resample(snapshot, 16_000, { isHQ: true })
    const resultLQ = resample(snapshot, 16_000, { isHQ: false })

    expect(resultHQ.planar[0]?.length).toBe(resultLQ.planar[0]?.length)
  })

  it("HQ 升采样后低频信号 RMS 与 LQ 接近（± 10%）", () => {
    // 升采样没有混叠问题；HQ/LQ 差异仅在高频细节，低频 RMS 应相近
    const input = makeSine(1_000, 8_000, 100, 8000)
    const snapshot = makeSnapshot([input], 8_000)

    const rmsHQ = rms(resample(snapshot, 16_000, { isHQ: true }).planar[0]!)
    const rmsLQ = rms(resample(snapshot, 16_000, { isHQ: false }).planar[0]!)

    expect(Math.abs(rmsHQ - rmsLQ) / (rmsLQ || 1)).toBeLessThan(0.1)
  })

  it("HQ 升采样输出所有样本在 Int16 范围内", () => {
    const input = makeSine(440, 8_000, 100, 32767)
    const snapshot = makeSnapshot([input], 8_000)
    const result = resample(snapshot, 16_000, { isHQ: true })

    for (const v of result.planar[0] ?? []) {
      expect(v).toBeGreaterThanOrEqual(-32768)
      expect(v).toBeLessThanOrEqual(32767)
    }
  })
})

// ---------------------------------------------------------------------------
// 降采样 LQ（isHQ = false，直接线性插值）
// ---------------------------------------------------------------------------

describe("resample — 降采样 LQ (isHQ=false)", () => {
  it("3× 降采样输出长度约为输入的 1/3", () => {
    const input = new Int16Array([0, 1000, 2000, 3000, 4000, 5000])
    const snapshot = makeSnapshot([input], 48_000)
    const result = resample(snapshot, 16_000, { isHQ: false })

    expect(result.sampleRate).toBe(16_000)
    expect(result.planar[0]?.length).toBe(2)
  })

  it("立体声各通道独立降采样", () => {
    const snapshot = makeSnapshot(
      [
        new Int16Array([0, 1000, 2000, 3000, 4000, 5000]),
        new Int16Array([0, -1000, -2000, -3000, -4000, -5000]),
      ],
      48_000,
      2
    )
    const result = resample(snapshot, 16_000, { isHQ: false })

    expect(result.sampleRate).toBe(16_000)
    expect(result.channels).toBe(2)
    expect(Array.from(result.planar[0] ?? [])).toEqual([0, 3000])
    expect(Array.from(result.planar[1] ?? [])).toEqual([0, -3000])
  })

  it("空通道降采样 LQ 不崩溃", () => {
    const snapshot = makeSnapshot([new Int16Array(0)], 48_000)
    const result = resample(snapshot, 16_000, { isHQ: false })

    expect(result.planar[0]?.length).toBe(0)
    expect(result.durationMs).toBe(0)
  })

  it("LQ 降采样对高频混叠信号不做衰减（混叠保留）", () => {
    // LQ 无低通，高于奈奎斯特的能量会折回，输出不应接近 0
    const aliasingFreq = 12_000
    const highFreqSignal = makeSine(aliasingFreq, 48_000, 100, 16000)
    const snapshot = makeSnapshot([highFreqSignal], 48_000)
    const resultLQ = resample(snapshot, 16_000, { isHQ: false })

    // 混叠后能量仍然显著（LQ 不过滤）
    expect(rms(resultLQ.planar[0]!)).toBeGreaterThan(100)
  })
})

// ---------------------------------------------------------------------------
// 降采样 HQ（isHQ = true，Hann 窗 sinc FIR + FFT overlap-add）
// ---------------------------------------------------------------------------

describe("resample — 降采样 HQ (isHQ=true)", () => {
  it("降采样后输出采样率和时长正确", () => {
    const input = new Int16Array(480).fill(1000)
    const snapshot = makeSnapshot([input], 48_000)
    const result = resample(snapshot, 16_000, { isHQ: true })

    expect(result.sampleRate).toBe(16_000)
    expect(result.durationMs).toBeCloseTo(10, 0)
  })

  it("高于奈奎斯特的频率被大幅衰减（抗混叠）", () => {
    // 48000→16000，奈奎斯特 8000 Hz；注入 12000 Hz 应被 HQ 低通过滤
    const aliasingFreq = 12_000
    const highFreqSignal = makeSine(aliasingFreq, 48_000, 200, 16000)
    const snapshot = makeSnapshot([highFreqSignal], 48_000)

    const resultHQ = resample(snapshot, 16_000, { isHQ: true })
    const resultLQ = resample(snapshot, 16_000, { isHQ: false })

    const rmsHQ = rms(resultHQ.planar[0]!)
    const rmsLQ = rms(resultLQ.planar[0]!)

    // HQ 输出能量应远小于 LQ（混叠被过滤）
    expect(rmsHQ).toBeLessThan(rmsLQ * 0.5)
  })

  it("通带内的低频信号几乎无损通过", () => {
    // 48000→16000，注入 1000 Hz（远低于奈奎斯特 8000 Hz）
    const input = makeSine(1_000, 48_000, 200, 16000)
    const snapshot = makeSnapshot([input], 48_000)
    const result = resample(snapshot, 16_000, { isHQ: true })

    // 排除两端边界效应后比较 RMS
    const inMid = input.slice(256, input.length - 256)
    const outMid = result.planar[0]!.slice(Math.floor(256 / 3), result.planar[0]!.length - Math.floor(256 / 3))

    const rmsIn = rms(inMid)
    const rmsOut = rms(outMid)

    // 通带增益应接近 1（允许 ±25% 误差，考虑边界效应）
    expect(rmsOut / rmsIn).toBeGreaterThan(0.6)
    expect(rmsOut / rmsIn).toBeLessThan(1.4)
  })

  it("空通道降采样 HQ 不崩溃", () => {
    const snapshot = makeSnapshot([new Int16Array(0)], 48_000)
    const result = resample(snapshot, 16_000, { isHQ: true })

    expect(result.planar[0]?.length).toBe(0)
    expect(result.durationMs).toBe(0)
  })

  it("HQ 降采样输出所有样本在 Int16 范围内", () => {
    const input = makeSine(1000, 48_000, 100, 32767)
    const snapshot = makeSnapshot([input], 48_000)
    const result = resample(snapshot, 16_000, { isHQ: true })

    for (const v of result.planar[0] ?? []) {
      expect(v).toBeGreaterThanOrEqual(-32768)
      expect(v).toBeLessThanOrEqual(32767)
    }
  })

  it("filterHalfTaps 选项生效（高 halfTaps 对阻带频率的衰减更强）", () => {
    // 使用远高于奈奎斯特的频率（14 kHz >> 8 kHz cutoff），此时大小 halfTaps 都会衰减
    // 但 halfTaps=128 的过渡带更陡，对阻带的衰减应更强（不弱于 halfTaps=8）
    const input = makeSine(14_000, 48_000, 200, 16000)
    const snapshot = makeSnapshot([input], 48_000)

    const resultHigh = resample(snapshot, 16_000, { isHQ: true, filterHalfTaps: 128 })
    const resultLow = resample(snapshot, 16_000, { isHQ: true, filterHalfTaps: 8 })

    const rmsHigh = rms(resultHigh.planar[0]!)
    const rmsLow = rms(resultLow.planar[0]!)

    // 两者都应大幅衰减阻带信号（相对原始 16000 振幅）
    expect(rmsHigh).toBeLessThan(4000) // < 25% 原始振幅
    expect(rmsLow).toBeLessThan(8000)  // low halfTaps 衰减稍弱也可接受
  })
})

// ---------------------------------------------------------------------------
// lowPassFilter（公共工具函数）
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
    const lowFreq = makeSine(1_000, sampleRate, 200) // 1 kHz << 8 kHz
    const filtered = lowPassFilter(lowFreq, sampleRate, cutoffHz, 64)

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
