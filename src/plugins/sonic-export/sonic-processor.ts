import type {
  NormalizedSonicTransformOptions,
  SonicTransformOptions,
} from "./types"

const DEFAULT_BLOCK_MS = 200
const MIN_BLOCK_MS = 100

export function normalizeSonicTransformOptions(
  options: SonicTransformOptions = {}
): NormalizedSonicTransformOptions {
  return {
    speed: normalizePositiveOption(options.speed, 1),
    pitch: normalizePositiveOption(options.pitch, 1),
    rate: normalizePositiveOption(options.rate, 1),
    volume: normalizePositiveOption(options.volume, 1),
    blockMs: Math.max(
      MIN_BLOCK_MS,
      Math.round(normalizePositiveOption(options.blockMs, DEFAULT_BLOCK_MS))
    ),
  }
}

/**
 * 对单个交织 PCM 块做同步 Sonic 处理。
 * 这里不使用 Worker；实时链路通过 blockMs 控制调用频率，离线链路由外层分块调度。
 */
export function transformInterleavedBlock(
  pcm: Int16Array,
  sampleRate: number,
  channels: number,
  options: SonicTransformOptions = {}
): Int16Array {
  const normalized = normalizeSonicTransformOptions(options)
  if (pcm.length === 0) {
    return new Int16Array(0)
  }

  const copied = new Int16Array(pcm.length)
  copied.set(pcm)
  let output: Int16Array = copied

  if (!isApproximatelyOne(normalized.rate)) {
    output = resampleInterleavedByRate(output, channels, normalized.rate)
  }

  if (!isApproximatelyOne(normalized.pitch)) {
    output = shiftPitch(output, sampleRate, channels, normalized.pitch)
  }

  if (!isApproximatelyOne(normalized.speed)) {
    output = stretchInterleaved(output, sampleRate, channels, normalized.speed)
  }

  if (!isApproximatelyOne(normalized.volume)) {
    output = scaleVolume(output, normalized.volume)
  }

  return output
}

/**
 * 对完整 PCM 做异步分块处理，块与块之间让出微任务，避免长音频在主线程形成单次长任务。
 */
export async function transformInterleavedPcm(
  pcm: Int16Array,
  sampleRate: number,
  channels: number,
  options: SonicTransformOptions = {}
): Promise<Int16Array> {
  const normalized = normalizeSonicTransformOptions(options)
  if (pcm.length === 0) {
    return new Int16Array(0)
  }

  const blockFrames = Math.max(
    1,
    Math.round((sampleRate * normalized.blockMs) / 1000)
  )
  const totalFrames = Math.floor(pcm.length / channels)
  const chunks: Int16Array[] = []

  for (
    let frameOffset = 0;
    frameOffset < totalFrames;
    frameOffset += blockFrames
  ) {
    const endFrame = Math.min(totalFrames, frameOffset + blockFrames)
    const chunk = pcm.subarray(frameOffset * channels, endFrame * channels)
    chunks.push(
      transformInterleavedBlock(chunk, sampleRate, channels, normalized)
    )
    await Promise.resolve()
  }

  return concatenateInt16Arrays(chunks)
}

function normalizePositiveOption(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return value
}

function isApproximatelyOne(value: number): boolean {
  return Math.abs(value - 1) < 1e-3
}

function scaleVolume(source: Int16Array, volume: number): Int16Array {
  const output = new Int16Array(source.length)
  for (let index = 0; index < source.length; index += 1) {
    output[index] = clampToInt16(Math.round((source[index] ?? 0) * volume))
  }

  return output
}

function shiftPitch(
  source: Int16Array,
  sampleRate: number,
  channels: number,
  pitch: number
): Int16Array {
  const pitched = resampleInterleavedByRate(source, channels, pitch)
  return stretchInterleaved(pitched, sampleRate, channels, 1 / pitch)
}

function stretchInterleaved(
  source: Int16Array,
  sampleRate: number,
  channels: number,
  speed: number
): Int16Array {
  const inputFrames = Math.floor(source.length / channels)
  if (inputFrames === 0) {
    return new Int16Array(0)
  }

  const targetFrames = Math.max(1, Math.round(inputFrames / speed))
  if (targetFrames === inputFrames) {
    return new Int16Array(source)
  }

  const windowFrames = chooseWindowFrames(sampleRate, inputFrames)
  if (inputFrames <= windowFrames) {
    return resampleInterleavedToFrames(source, channels, targetFrames)
  }

  const inputHop = Math.max(1, Math.floor(windowFrames / 2))
  const outputHop = Math.max(1, Math.round(inputHop / speed))
  const window = createHannWindow(windowFrames)
  const segmentCount =
    Math.max(0, Math.ceil((inputFrames - windowFrames) / inputHop)) + 1
  const estimatedFrames =
    outputHop * Math.max(0, segmentCount - 1) + windowFrames
  const accum = new Float32Array(estimatedFrames * channels)
  const weights = new Float32Array(estimatedFrames)

  let inputFrame = 0
  let outputFrame = 0
  while (inputFrame < inputFrames) {
    const remaining = inputFrames - inputFrame
    const copyFrames = Math.min(windowFrames, remaining)

    for (let frameIndex = 0; frameIndex < copyFrames; frameIndex += 1) {
      const weight = window[frameIndex] ?? 1
      const outputIndex = outputFrame + frameIndex
      weights[outputIndex] = (weights[outputIndex] ?? 0) + weight

      for (let channel = 0; channel < channels; channel += 1) {
        const sourceIndex = (inputFrame + frameIndex) * channels + channel
        const accumIndex = outputIndex * channels + channel
        accum[accumIndex] =
          (accum[accumIndex] ?? 0) + (source[sourceIndex] ?? 0) * weight
      }
    }

    if (remaining <= windowFrames) {
      break
    }

    inputFrame += inputHop
    outputFrame += outputHop
  }

  const normalized = new Int16Array(estimatedFrames * channels)
  for (let frameIndex = 0; frameIndex < estimatedFrames; frameIndex += 1) {
    const weight = weights[frameIndex] ?? 0
    const gain = weight > 0 ? 1 / weight : 1
    for (let channel = 0; channel < channels; channel += 1) {
      const index = frameIndex * channels + channel
      normalized[index] = clampToInt16(Math.round((accum[index] ?? 0) * gain))
    }
  }

  return resampleInterleavedToFrames(normalized, channels, targetFrames)
}

function chooseWindowFrames(sampleRate: number, inputFrames: number): number {
  const requested =
    sampleRate >= 44_100 ? 2048 : sampleRate >= 22_050 ? 1024 : 512
  return Math.min(requested, Math.max(256, inputFrames))
}

function createHannWindow(size: number): Float32Array {
  const window = new Float32Array(size)
  if (size === 1) {
    window[0] = 1
    return window
  }

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1))
  }

  return window
}

function resampleInterleavedByRate(
  source: Int16Array,
  channels: number,
  rate: number
): Int16Array {
  const inputFrames = Math.floor(source.length / channels)
  const outputFrames = Math.max(1, Math.round(inputFrames / rate))
  return resampleInterleavedToFrames(source, channels, outputFrames)
}

function resampleInterleavedToFrames(
  source: Int16Array,
  channels: number,
  outputFrames: number
): Int16Array {
  const inputFrames = Math.floor(source.length / channels)
  if (inputFrames === 0 || outputFrames <= 0) {
    return new Int16Array(0)
  }

  if (inputFrames === 1) {
    const repeated = new Int16Array(outputFrames * channels)
    for (let frameIndex = 0; frameIndex < outputFrames; frameIndex += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        repeated[frameIndex * channels + channel] = source[channel] ?? 0
      }
    }
    return repeated
  }

  const output = new Int16Array(outputFrames * channels)
  const maxInputIndex = inputFrames - 1
  const denominator = Math.max(1, outputFrames - 1)

  for (let frameIndex = 0; frameIndex < outputFrames; frameIndex += 1) {
    const sourcePosition = (frameIndex * maxInputIndex) / denominator
    const leftFrame = Math.floor(sourcePosition)
    const rightFrame = Math.min(maxInputIndex, leftFrame + 1)
    const blend = sourcePosition - leftFrame

    for (let channel = 0; channel < channels; channel += 1) {
      const left = source[leftFrame * channels + channel] ?? 0
      const right = source[rightFrame * channels + channel] ?? left
      output[frameIndex * channels + channel] = clampToInt16(
        Math.round(left + (right - left) * blend)
      )
    }
  }

  return output
}

function concatenateInt16Arrays(chunks: readonly Int16Array[]): Int16Array {
  let totalLength = 0
  for (const chunk of chunks) {
    totalLength += chunk.length
  }

  const output = new Int16Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }

  return output
}

function clampToInt16(value: number): number {
  return Math.max(-32768, Math.min(32767, value))
}
