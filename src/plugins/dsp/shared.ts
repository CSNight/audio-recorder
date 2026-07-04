import type { AudioFrame } from "../../types"

/** 基础 PCM 归一化：内部 DSP 统一在 [-1, 1] 浮点域上运算。 */
export function normalizePcmSample(sample: number): number {
  return Math.max(-1, Math.min(1, sample / 32768))
}

/** 将内部浮点结果压回 Int16 PCM，避免下游编码器接收到超范围样本。 */
export function denormalizePcmSample(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
}

export function createFrameFromPlanar(
  planar: Int16Array[],
  sampleRate: number,
  timestamp: number
): AudioFrame {
  const frameLength = planar[0]?.length ?? 0
  return {
    channels: planar.length,
    sampleRate,
    timestamp,
    durationMs: frameLength === 0 ? 0 : (frameLength / sampleRate) * 1000,
    planar,
  }
}
