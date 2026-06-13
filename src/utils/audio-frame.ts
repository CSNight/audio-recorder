import type { AudioChannelCount, AudioFrame } from "@/types"

export function resolveChannelCount(
  requested?: number | null
): AudioChannelCount {
  // Phase 1 只支持单声道/双声道，其他输入统一收敛到单声道语义。
  return requested === 2 ? 2 : 1
}

export function toInt16Sample(sample: number): number {
  // PCM float 理论范围是 [-1, 1]，超出范围的浏览器输入需要先钳制再转换。
  const clamped = Math.max(-1, Math.min(1, sample))
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
}

export function createAudioFrame(
  planarFloat: readonly Float32Array[],
  sampleRate: number,
  timestamp: number
): AudioFrame {
  // 实际输出声道数只取当前库支持的范围，避免下游收到不稳定的多声道数据结构。
  const channels = resolveChannelCount(planarFloat.length)
  const sourceChannels = planarFloat.slice(0, channels)
  const frameLength = sourceChannels[0]?.length ?? 0

  const planar = sourceChannels.map((channel) => {
    const output = new Int16Array(frameLength)

    for (let index = 0; index < frameLength; index += 1) {
      // 逐采样转换为 Int16 PCM，供后续编码器或波形逻辑直接消费。
      output[index] = toInt16Sample(channel[index] ?? 0)
    }

    return output
  })

  return {
    channels,
    sampleRate,
    timestamp,
    // durationMs 直接由帧长和采样率推导，避免依赖外部时钟累计误差。
    durationMs: frameLength === 0 ? 0 : (frameLength / sampleRate) * 1000,
    planar,
  }
}
