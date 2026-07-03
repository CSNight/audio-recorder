import type { PcmBufferSnapshot } from "../buffer/types"

export interface ResampledPcm {
  sampleRate: number
  channels: number
  durationMs: number
  planar: Int16Array[]
}

export interface ResampleOptions {
  /**
   * 是否使用高保真算法。
   *
   * - 降采样（HQ = true）：Hann 窗 sinc FIR 低通滤波 + 抽取（FFT overlap-add），
   *   消除混叠失真，适合语音/音乐上传场景。
   * - 降采样（HQ = false）：直接线性插值，速度快但降采样时会产生高频混叠噪声。
   * - 升采样（HQ = true）：Lanczos-3 sinc 插值，保留高频细节，适合音质优先场景。
   * - 升采样（HQ = false）：线性插值，速度快，引入轻微高频平滑，适合实时预览场景。
   *
   * 默认 `false`（快速模式）。
   */
  isHQ?: boolean
  /**
   * 低通滤波器单侧抽头数（仅降采样 HQ 模式生效）。
   * 越大截止越陡但越慢，默认 64。
   */
  filterHalfTaps?: number
}

// ---------------------------------------------------------------------------
// 公共统一入口
// ---------------------------------------------------------------------------

/**
 * PCM 重采样统一入口。
 *
 * 根据 `options.isHQ` 自动选择算法：
 * - 升采样 + HQ：Lanczos-3 sinc 插值
 * - 升采样 + LQ：线性插值
 * - 降采样 + HQ：Hann 窗 sinc FIR 低通 + 抽取（FFT overlap-add）
 * - 降采样 + LQ：直接线性插值（有混叠，轻量）
 *
 * 采样率相同时直接复制，不执行任何滤波/插值。
 */
export function resample(
  snapshot: PcmBufferSnapshot,
  targetSampleRate: number,
  options: ResampleOptions = {}
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
  const isHQ = options.isHQ ?? false
  const filterHalfTaps = options.filterHalfTaps ?? 64

  const planar = snapshot.planar.map((channel) =>
    isDownsample
      ? downsampleChannel(
          channel,
          snapshot.sampleRate,
          targetSampleRate,
          isHQ,
          filterHalfTaps
        )
      : upsampleChannel(channel, snapshot.sampleRate, targetSampleRate, isHQ)
  )

  const frameLength = planar[0]?.length ?? 0

  return {
    sampleRate: targetSampleRate,
    channels: snapshot.channels,
    durationMs: frameLength === 0 ? 0 : (frameLength / targetSampleRate) * 1000,
    planar,
  }
}
function linearResample(
  input: Int16Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Int16Array {
  const ratio = sourceSampleRate / targetSampleRate
  const targetLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Int16Array(targetLength)

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const sourcePosition = targetIndex * ratio
    const leftIndex = Math.min(input.length - 1, Math.floor(sourcePosition))
    const rightIndex = Math.min(input.length - 1, leftIndex + 1)
    const weight = sourcePosition - leftIndex
    const leftSample = input[leftIndex] ?? 0
    const rightSample = input[rightIndex] ?? leftSample

    output[targetIndex] = Math.round(
      leftSample + (rightSample - leftSample) * weight
    )
  }

  return output
}

// ---------------------------------------------------------------------------
// 升采样实现
// ---------------------------------------------------------------------------

/**
 * 升采样单通道 PCM。
 *
 * - HQ = true：Lanczos-3 sinc 插值（减少高频平滑，音质更好）
 * - HQ = false：线性插值（速度更快，引入轻微高频平滑）
 *
 * 升采样不存在混叠问题，故无需低通预滤波。
 */
function upsampleChannel(
  input: Int16Array,
  sourceSampleRate: number,
  targetSampleRate: number,
  isHQ: boolean
): Int16Array {
  if (input.length === 0) {
    return new Int16Array(0)
  }

  return isHQ
    ? upsampleChannelHQ(input, sourceSampleRate, targetSampleRate)
    : linearResample(input, sourceSampleRate, targetSampleRate)
}

/**
 * 升采样 HQ：Lanczos-3 sinc 插值。
 *
 * 使用 Lanczos 窗（a=3）对 sinc 核加权，保留更多高频细节，减少线性插值带来的
 * 高频滚降（模糊感）。适合音质优先的离线处理场景。
 *
 * 复杂度 O(n × 2a)，a=3 时每输出样本需 6 次卷积，对超长信号可考虑改用 polyphase
 * 滤波器组进一步加速。
 */
function upsampleChannelHQ(
  input: Int16Array,
  sourceSampleRate: number,
  targetSampleRate: number
): Int16Array {
  const ratio = sourceSampleRate / targetSampleRate
  const targetLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Int16Array(targetLength)
  const a = 3 // Lanczos 窗阶数

  for (let targetIndex = 0; targetIndex < targetLength; targetIndex += 1) {
    const sourcePosition = targetIndex * ratio
    const center = Math.floor(sourcePosition)
    let value = 0
    let weightSum = 0

    for (let k = center - a + 1; k <= center + a; k++) {
      const clampedK = Math.max(0, Math.min(input.length - 1, k))
      const x = sourcePosition - k
      const w = lanczos(x, a)
      value += (input[clampedK] ?? 0) * w
      weightSum += w
    }

    // 归一化防止边界处因截断产生增益误差
    const normalized = weightSum > 1e-10 ? value / weightSum : value
    output[targetIndex] = Math.max(
      -32768,
      Math.min(32767, Math.round(normalized))
    )
  }

  return output
}

/** Lanczos 核函数：sinc(x) * sinc(x/a)，|x| < a 时有效，否则为 0 */
function lanczos(x: number, a: number): number {
  if (Math.abs(x) < 1e-10) return 1
  if (Math.abs(x) >= a) return 0
  const pix = Math.PI * x
  return (a * Math.sin(pix) * Math.sin(pix / a)) / (pix * pix)
}

// ---------------------------------------------------------------------------
// 降采样实现
// ---------------------------------------------------------------------------

/**
 * 降采样单通道 PCM。
 *
 * - HQ = true：Hann 窗 sinc FIR 低通滤波（FFT overlap-add）+ 抽取，消除混叠
 * - HQ = false：直接线性插值（快速，但降采样时会产生高频混叠噪声）
 */
function downsampleChannel(
  input: Int16Array,
  sourceSampleRate: number,
  targetSampleRate: number,
  isHQ: boolean,
  filterHalfTaps: number
): Int16Array {
  if (input.length === 0) {
    return new Int16Array(0)
  }

  if (isHQ) {
    // 先低通滤波消除奈奎斯特以上的频率分量，再抽取
    const filtered = lowPassFilter(
      input,
      sourceSampleRate,
      targetSampleRate / 2,
      filterHalfTaps
    )
    return linearResample(filtered, sourceSampleRate, targetSampleRate)
  }

  return linearResample(input, sourceSampleRate, targetSampleRate)
}

// ---------------------------------------------------------------------------
// 低通 FIR 滤波器（公开，可单独使用）
// ---------------------------------------------------------------------------

/**
 * 基于 Hann 窗 sinc 的 FIR 低通滤波器，使用 FFT overlap-add 加速。
 *
 * 复杂度 O(n log M)（overlap-add），对典型音频帧（≥4096 样本，halfTaps=64）
 * 比直接卷积 O(n×M) 快约 10–30×。
 *
 * @param input      输入 Int16 PCM
 * @param sampleRate 当前采样率（Hz）
 * @param cutoffHz   截止频率（Hz），通常设为 targetSampleRate / 2
 * @param halfTaps   单侧抽头数（总长度 = 2×halfTaps + 1），默认 64
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
    const win = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (totalTaps - 1)))
    const sinc =
      n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n)
    const coeff = win * sinc
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

  // ---------------------------------------------------------------------------
  // FFT overlap-add 卷积
  //
  // 将长度 N 的输入切成长度 L 的块，每块与长度 M=totalTaps 的核做 FFT 域快速卷积
  // （DFT 长度 P = nextPow2(L + M - 1)），再将各块输出线性叠加（overlap-add）。
  // ---------------------------------------------------------------------------

  const blockSize = Math.max(totalTaps, nextPow2(totalTaps * 8))
  const fftSize = nextPow2(blockSize + totalTaps - 1)

  // 将核补零至 fftSize 并预先变换到频域
  const kernelPadded = new Float64Array(fftSize)
  kernelPadded.set(kernel)
  const kernelFreq = fftForward(kernelPadded, fftSize)

  const output = new Float64Array(input.length)

  for (let blockStart = 0; blockStart < input.length; blockStart += blockSize) {
    const blockEnd = Math.min(blockStart + blockSize, input.length)
    const actualLen = blockEnd - blockStart

    const block = new Float64Array(fftSize)
    for (let i = 0; i < actualLen; i++) {
      block[i] = input[blockStart + i] ?? 0
    }

    const blockFreq = fftForward(block, fftSize)
    const product = complexMultiply(blockFreq, kernelFreq, fftSize)
    const convResult = fftInverse(product, fftSize)

    const writeLen = Math.min(convResult.length, output.length - blockStart)
    for (let i = 0; i < writeLen; i++) {
      output[blockStart + i] =
        (output[blockStart + i] ?? 0) + (convResult[i] ?? 0)
    }
  }

  // 补偿 FIR 群延迟（M 个样本），将结果向左移 M 个样本
  const out16 = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    out16[i] = Math.max(-32768, Math.min(32767, Math.round(output[i + M] ?? 0)))
  }

  return out16
}

// ---------------------------------------------------------------------------
// 纯 JS FFT 辅助实现（Cooley-Tukey 迭代基-2 DIT）
// 返回交错实虚数组：[re0, im0, re1, im1, …]，长度 = 2 × fftSize
// ---------------------------------------------------------------------------

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/** 正向 FFT，输入实数序列，返回交错复数 [re, im, re, im, …] */
function fftForward(real: Float64Array, fftSize: number): Float64Array {
  const out = new Float64Array(fftSize * 2)
  for (let i = 0; i < fftSize; i++) {
    out[i * 2] = real[i] ?? 0
  }
  fftInPlace(out, fftSize, false)
  return out
}

/** 逆向 FFT，输入交错复数，返回实数序列（已除以 N） */
function fftInverse(freq: Float64Array, fftSize: number): Float64Array {
  const buf = new Float64Array(freq)
  fftInPlace(buf, fftSize, true)
  const scale = 1 / fftSize
  const result = new Float64Array(fftSize)
  for (let i = 0; i < fftSize; i++) {
    result[i] = (buf[i * 2] ?? 0) * scale
  }
  return result
}

/** 频域逐点复数乘法，a 和 b 均为交错 [re, im, …] 格式 */
function complexMultiply(
  a: Float64Array,
  b: Float64Array,
  fftSize: number
): Float64Array {
  const out = new Float64Array(fftSize * 2)
  for (let i = 0; i < fftSize; i++) {
    const ar = a[i * 2] ?? 0
    const ai = a[i * 2 + 1] ?? 0
    const br = b[i * 2] ?? 0
    const bi = b[i * 2 + 1] ?? 0
    out[i * 2] = ar * br - ai * bi
    out[i * 2 + 1] = ar * bi + ai * br
  }
  return out
}

/**
 * 原地 Cooley-Tukey 迭代基-2 DIT FFT（或 IFFT）。
 * buf 格式：交错实虚 [re0, im0, re1, im1, …]，长度 = 2 × N（N 必须是 2 的幂）。
 */
function fftInPlace(buf: Float64Array, N: number, inverse: boolean): void {
  // 位反转置换（bit-reversal permutation）
  let j = 0
  for (let i = 1; i < N; i++) {
    let bit = N >> 1
    for (; j & bit; bit >>= 1) {
      j ^= bit
    }
    j ^= bit
    if (i < j) {
      let tmp = buf[i * 2] ?? 0
      buf[i * 2] = buf[j * 2] ?? 0
      buf[j * 2] = tmp
      tmp = buf[i * 2 + 1] ?? 0
      buf[i * 2 + 1] = buf[j * 2 + 1] ?? 0
      buf[j * 2 + 1] = tmp
    }
  }

  // 蝶形运算
  const sign = inverse ? 1 : -1
  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1
    const angStep = (sign * 2 * Math.PI) / len
    const wRe = Math.cos(angStep)
    const wIm = Math.sin(angStep)

    for (let i = 0; i < N; i += len) {
      let curRe = 1
      let curIm = 0

      for (let k = 0; k < halfLen; k++) {
        const uRe = buf[(i + k) * 2] ?? 0
        const uIm = buf[(i + k) * 2 + 1] ?? 0
        const vRe =
          (buf[(i + k + halfLen) * 2] ?? 0) * curRe -
          (buf[(i + k + halfLen) * 2 + 1] ?? 0) * curIm
        const vIm =
          (buf[(i + k + halfLen) * 2] ?? 0) * curIm +
          (buf[(i + k + halfLen) * 2 + 1] ?? 0) * curRe

        buf[(i + k) * 2] = uRe + vRe
        buf[(i + k) * 2 + 1] = uIm + vIm
        buf[(i + k + halfLen) * 2] = uRe - vRe
        buf[(i + k + halfLen) * 2 + 1] = uIm - vIm

        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}
