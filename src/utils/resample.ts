import type { PcmBufferSnapshot } from "@/buffer/types"
import type { AudioChannelCount } from "@/types"

export interface ResampledPcm {
  sampleRate: number
  channels: AudioChannelCount
  durationMs: number
  planar: Int16Array[]
}

/**
 * 线性插值重采样。注意：不带抗混叠低通滤波，**降采样时会产生混叠失真**
 * （高频折返为可闻噪声）。适用于轻量场景；对保真有要求时应在外部先做低通。
 */
export function resamplePlanarPcm(
  snapshot: PcmBufferSnapshot,
  targetSampleRate: number
): ResampledPcm {
  if (targetSampleRate <= 0) {
    throw new Error(
      `Resample target sampleRate must be positive, received ${targetSampleRate}.`
    )
  }

  if (snapshot.planar.length === 0) {
    throw new Error("Resample snapshot must contain at least one channel.")
  }

  if (targetSampleRate === snapshot.sampleRate) {
    return {
      sampleRate: snapshot.sampleRate,
      channels: snapshot.channels,
      durationMs: snapshot.durationMs,
      planar: snapshot.planar.map((channel) => new Int16Array(channel)),
    }
  }

  const planar = snapshot.planar.map((channel) =>
    resampleChannel(channel, snapshot.sampleRate, targetSampleRate)
  )
  const frameLength = planar[0]?.length ?? 0

  return {
    sampleRate: targetSampleRate,
    channels: snapshot.channels,
    durationMs: frameLength === 0 ? 0 : (frameLength / targetSampleRate) * 1000,
    planar,
  }
}

function resampleChannel(
  input: Int16Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Int16Array {
  if (input.length === 0) {
    return new Int16Array(0)
  }

  const ratio = sourceSampleRate / targetSampleRate
  const targetLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Int16Array(targetLength)

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const sourcePosition = targetIndex * ratio
    const leftIndex = Math.min(input.length - 1, Math.floor(sourcePosition))
    const rightIndex = Math.min(input.length - 1, leftIndex + 1)
    const interpolationWeight = sourcePosition - leftIndex
    const leftSample = input[leftIndex] ?? 0
    const rightSample = input[rightIndex] ?? leftSample

    output[targetIndex] = Math.round(
      leftSample + (rightSample - leftSample) * interpolationWeight
    )
  }

  return output
}

// ---------------------------------------------------------------------------
// 带低通滤波的保真降采样
// ---------------------------------------------------------------------------

/**
 * 使用窗函数 sinc 低通滤波器（Hann 窗）进行抗混叠重采样。
 *
 * 降采样前先以奈奎斯特频率（targetSampleRate / 2）为截止频率做低通滤波，
 * 从而消除折叠噪声，适合对保真度有要求的场景（如语音/音乐录制上传）。
 *
 * 升采样时与 {@link resamplePlanarPcm} 行为相同（线性插值），因为升采样
 * 不存在混叠问题。
 *
 * @param snapshot        原始 PCM 快照
 * @param targetSampleRate 目标采样率（Hz）
 * @param filterHalfTaps  滤波器单侧抽头数，默认 64；越大截止越陡，但越慢
 */
export function resamplePlanarPcmHQ(
  snapshot: PcmBufferSnapshot,
  targetSampleRate: number,
  filterHalfTaps = 64
): ResampledPcm {
  if (targetSampleRate <= 0) {
    throw new Error(
      `Resample target sampleRate must be positive, received ${targetSampleRate}.`
    )
  }

  if (snapshot.planar.length === 0) {
    throw new Error("Resample snapshot must contain at least one channel.")
  }

  if (targetSampleRate === snapshot.sampleRate) {
    return {
      sampleRate: snapshot.sampleRate,
      channels: snapshot.channels,
      durationMs: snapshot.durationMs,
      planar: snapshot.planar.map((channel) => new Int16Array(channel)),
    }
  }

  const isDownsample = targetSampleRate < snapshot.sampleRate

  const planar = snapshot.planar.map((channel) => {
    if (isDownsample) {
      // 降采样：先低通滤波再抽取
      const filtered = lowPassFilter(
        channel,
        snapshot.sampleRate,
        targetSampleRate / 2,
        filterHalfTaps
      )
      return resampleChannel(filtered, snapshot.sampleRate, targetSampleRate)
    }
    // 升采样：不存在混叠，直接线性插值
    return resampleChannel(channel, snapshot.sampleRate, targetSampleRate)
  })

  const frameLength = planar[0]?.length ?? 0

  return {
    sampleRate: targetSampleRate,
    channels: snapshot.channels,
    durationMs: frameLength === 0 ? 0 : (frameLength / targetSampleRate) * 1000,
    planar,
  }
}

/**
 * 基于窗函数 sinc（Hann 窗）的 FIR 低通滤波器。
 *
 * @param input        输入 Int16 PCM
 * @param sampleRate   当前采样率（Hz），用于将截止频率归一化
 * @param cutoffHz     截止频率（Hz），通常设为 targetSampleRate / 2
 * @param halfTaps     单侧抽头数（总长度 = 2*halfTaps + 1）
 */
export function lowPassFilter(
  input: Int16Array,
  sampleRate: number,
  cutoffHz: number,
  halfTaps = 64
): Int16Array {
  if (halfTaps < 1) {
    throw new Error(
      `lowPassFilter halfTaps must be at least 1, received ${halfTaps}.`
    )
  }

  if (!(cutoffHz > 0) || cutoffHz >= sampleRate / 2) {
    throw new Error(
      `lowPassFilter cutoffHz must be within (0, sampleRate / 2), received cutoffHz=${cutoffHz}, sampleRate=${sampleRate}.`
    )
  }

  const M = halfTaps
  const totalTaps = 2 * M + 1
  const fc = cutoffHz / sampleRate // 归一化截止频率 (0, 0.5)

  // 计算 Hann 窗加权的 sinc 系数
  const kernel = new Float64Array(totalTaps)
  let kernelSum = 0
  for (let i = 0; i < totalTaps; i++) {
    const n = i - M
    // Hann 窗
    const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (totalTaps - 1)))
    // sinc 函数
    const sinc =
      n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n)
    const coeff = window * sinc
    kernel[i] = coeff
    kernelSum += coeff
  }

  if (Math.abs(kernelSum) < 1e-12) {
    throw new Error(
      `lowPassFilter produced a degenerate kernel (kernelSum≈0) for cutoffHz=${cutoffHz}, sampleRate=${sampleRate}, halfTaps=${halfTaps}.`
    )
  }

  // 归一化，确保直流增益 = 1
  for (let i = 0; i < totalTaps; i++) {
    kernel[i] = (kernel[i] ?? 0) / kernelSum
  }

  // 线性卷积（边界零填充）
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    let acc = 0
    for (let k = 0; k < totalTaps; k++) {
      const srcIdx = i - M + k
      const sample =
        srcIdx >= 0 && srcIdx < input.length ? (input[srcIdx] ?? 0) : 0
      acc += (kernel[k] ?? 0) * sample
    }
    // 截断到 Int16 范围
    output[i] = Math.max(-32768, Math.min(32767, Math.round(acc)))
  }

  return output
}
