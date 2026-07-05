import type { FrequencyHistogramOptions } from "./types"

type ResolvedOptions = Required<FrequencyHistogramOptions>

const SILENCE_RMS_THRESHOLD = 0.003
const SILENCE_PEAK_THRESHOLD = 0.012
const SPECTRUM_DB_FLOOR = -72
const SPECTRUM_PEAK_GATE = 0.08
const SPECTRUM_AVERAGE_GATE = 0.025

export function resolveFrequencyHistogramOptions(
  options: FrequencyHistogramOptions = {}
): ResolvedOptions {
  const fftSize = options.fftSize ?? 2048
  const barCount = Math.max(1, Math.floor(options.barCount ?? 64))
  const frameInterval = Math.max(1, Math.floor(options.frameInterval ?? 1))

  if ((fftSize & (fftSize - 1)) !== 0) {
    throw new Error("Frequency histogram fftSize must be a power of two.")
  }

  return {
    fftSize,
    barCount,
    frameInterval,
  }
}

/**
 * 对单个实数窗口做 FFT 并输出对数分桶频谱。
 * 这里保留纯 TS 实现，避免插件分析链路依赖浏览器专属 API。
 */
export function analyzeFrequencyBars(
  samples: Float32Array,
  sampleRate: number,
  options: ResolvedOptions
): Float32Array {
  const { peak, rms } = measureSignalLevel(samples)
  if (peak < SILENCE_PEAK_THRESHOLD && rms < SILENCE_RMS_THRESHOLD) {
    return new Float32Array(options.barCount)
  }

  const windowedReal = applyHannWindow(samples)
  const imag = new Float32Array(windowedReal.length)

  runRadix2Fft(windowedReal, imag)

  const halfSize = windowedReal.length >> 1
  const magnitudes = new Float32Array(halfSize)
  const normalization = Math.max(1, windowedReal.length / 2)

  for (let index = 0; index < halfSize; index += 1) {
    const real = windowedReal[index] ?? 0
    const imaginary = imag[index] ?? 0

    magnitudes[index] =
      Math.sqrt(real * real + imaginary * imaginary) / normalization
  }

  const bars = createLogBars(
    magnitudes,
    sampleRate,
    windowedReal.length,
    options.barCount
  )

  const barEnergy = measureBarEnergy(bars)
  if (barEnergy.peak < SPECTRUM_PEAK_GATE) {
    return new Float32Array(options.barCount)
  }

  if (barEnergy.average < SPECTRUM_AVERAGE_GATE) {
    return new Float32Array(options.barCount)
  }

  return bars
}

function applyHannWindow(samples: Float32Array): Float32Array {
  const result = new Float32Array(samples.length)
  const lengthMinusOne = Math.max(1, samples.length - 1)

  for (let index = 0; index < samples.length; index += 1) {
    const weight = 0.5 * (1 - Math.cos((2 * Math.PI * index) / lengthMinusOne))
    result[index] = (samples[index] ?? 0) * weight
  }

  return result
}

function runRadix2Fft(real: Float32Array, imag: Float32Array): void {
  const size = real.length
  let shift = 1
  while (1 << shift < size) {
    shift += 1
  }

  for (let index = 0; index < size; index += 1) {
    const reversed = reverseBits(index, shift)
    if (reversed > index) {
      swap(real, index, reversed)
      swap(imag, index, reversed)
    }
  }

  for (let blockSize = 2; blockSize <= size; blockSize <<= 1) {
    const halfBlock = blockSize >> 1
    const phaseStep = (-2 * Math.PI) / blockSize

    for (let blockStart = 0; blockStart < size; blockStart += blockSize) {
      for (let offset = 0; offset < halfBlock; offset += 1) {
        const evenIndex = blockStart + offset
        const oddIndex = evenIndex + halfBlock
        const angle = phaseStep * offset
        const twiddleReal = Math.cos(angle)
        const twiddleImag = Math.sin(angle)
        const oddReal = real[oddIndex] ?? 0
        const oddImag = imag[oddIndex] ?? 0
        const tempReal = twiddleReal * oddReal - twiddleImag * oddImag
        const tempImag = twiddleReal * oddImag + twiddleImag * oddReal
        const evenReal = real[evenIndex] ?? 0
        const evenImag = imag[evenIndex] ?? 0

        real[oddIndex] = evenReal - tempReal
        imag[oddIndex] = evenImag - tempImag
        real[evenIndex] = evenReal + tempReal
        imag[evenIndex] = evenImag + tempImag
      }
    }
  }
}

function createLogBars(
  magnitudes: Float32Array,
  sampleRate: number,
  fftSize: number,
  barCount: number
): Float32Array {
  const nyquist = sampleRate / 2
  const bars = new Float32Array(barCount)
  const minFrequency = 20
  const logMin = Math.log10(minFrequency)
  const logMax = Math.log10(Math.max(minFrequency + 1, nyquist))

  for (let barIndex = 0; barIndex < barCount; barIndex += 1) {
    const startFreq = Math.pow(
      10,
      logMin + ((logMax - logMin) * barIndex) / barCount
    )
    const endFreq = Math.pow(
      10,
      logMin + ((logMax - logMin) * (barIndex + 1)) / barCount
    )
    const startBin = clampBin(
      Math.floor((startFreq / sampleRate) * fftSize),
      magnitudes.length
    )
    const endBin = clampBin(
      Math.ceil((endFreq / sampleRate) * fftSize),
      magnitudes.length
    )

    let peak = 0
    for (let bin = startBin; bin < Math.max(startBin + 1, endBin); bin += 1) {
      peak = Math.max(peak, magnitudes[bin] ?? 0)
    }
    bars[barIndex] = normalizeDecibels(toDecibels(peak))
  }

  return bars
}

function clampBin(bin: number, max: number): number {
  return Math.max(0, Math.min(max - 1, bin))
}

function measureSignalLevel(samples: Float32Array): {
  peak: number
  rms: number
} {
  let peak = 0
  let totalSquare = 0

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0
    const magnitude = Math.abs(sample)
    peak = Math.max(peak, magnitude)
    totalSquare += sample * sample
  }

  return {
    peak,
    rms: samples.length === 0 ? 0 : Math.sqrt(totalSquare / samples.length),
  }
}

function measureBarEnergy(bars: Float32Array): {
  peak: number
  average: number
} {
  let peak = 0
  let total = 0

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index] ?? 0
    peak = Math.max(peak, bar)
    total += bar
  }

  return {
    peak,
    average: bars.length === 0 ? 0 : total / bars.length,
  }
}

function toDecibels(magnitude: number): number {
  if (magnitude <= 0) {
    return SPECTRUM_DB_FLOOR
  }

  return 20 * Math.log10(magnitude)
}

function normalizeDecibels(db: number): number {
  if (db <= SPECTRUM_DB_FLOOR) {
    return 0
  }

  if (db >= 0) {
    return 1
  }

  return (db - SPECTRUM_DB_FLOOR) / -SPECTRUM_DB_FLOOR
}

function reverseBits(value: number, bitCount: number): number {
  let reversed = 0
  for (let index = 0; index < bitCount; index += 1) {
    reversed = (reversed << 1) | ((value >> index) & 1)
  }
  return reversed
}

function swap(array: Float32Array, first: number, second: number): void {
  const temp = array[first] ?? 0
  array[first] = array[second] ?? 0
  array[second] = temp
}
