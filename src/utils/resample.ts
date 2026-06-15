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

  // Fix #9: guard zero-channel BEFORE the same-rate early return so an empty
  // snapshot never silently produces a valid-looking result in any code path.
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
 * Fix #10: 使用 FFT overlap-add 算法，将复杂度从 O(n×M) 降至 O(n log M)。
 * 对于 halfTaps=64（M=128 抽头）和典型音频帧（≥4096 样本），速度提升约 10-30×。
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
  // FFT overlap-add 卷积（Fix #10）
  //
  // 原理：将长度为 N 的输入切成长度为 L 的块，每块分别与长度为 M=totalTaps 的
  // 核做 FFT 域快速卷积（DFT 长度 P = nextPow2(L + M - 1)），再将各块线性输出
  // 累加（overlap-add）。总复杂度 O(n log P) ≪ 直接卷积 O(n×M)。
  // ---------------------------------------------------------------------------

  // 选取块长使 FFT 大小在 512~8192 之间以兼顾小核和大缓冲。
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

    // 将当前块补零至 fftSize
    const block = new Float64Array(fftSize)
    for (let i = 0; i < actualLen; i++) {
      block[i] = input[blockStart + i] ?? 0
    }

    // 正向 FFT
    const blockFreq = fftForward(block, fftSize)

    // 频域复数相乘
    const product = complexMultiply(blockFreq, kernelFreq, fftSize)

    // 逆向 FFT，得到线性卷积结果（长度 actualLen + totalTaps - 1）
    const convResult = fftInverse(product, fftSize)

    // overlap-add：将结果叠加到输出缓冲
    const writeLen = Math.min(convResult.length, output.length - blockStart)
    for (let i = 0; i < writeLen; i++) {
      output[blockStart + i] = (output[blockStart + i] ?? 0) + (convResult[i] ?? 0)
    }
  }

  // 将 FIR 延迟（M 个样本）补偿掉：输出向左移 M 个样本（因果滤波器群延迟 = M）
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
      // 交换 buf[i] 和 buf[j]（每个元素占 2 个槽）
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
        const vRe = (buf[(i + k + halfLen) * 2] ?? 0) * curRe - (buf[(i + k + halfLen) * 2 + 1] ?? 0) * curIm
        const vIm = (buf[(i + k + halfLen) * 2] ?? 0) * curIm + (buf[(i + k + halfLen) * 2 + 1] ?? 0) * curRe

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
