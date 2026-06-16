import type { ChunkedEncoder, ChunkedEncoderDefinition } from "@/plugins/streaming-export/types"
import { Mp3EncoderClass } from "@/codecs/mp3/lamejs-adapter"

/** MP3 ChunkedEncoder 选项 */
export interface Mp3ChunkedEncoderOptions {
  /** 比特率（kbps），默认 128 */
  bitrateKbps?: number
}

/**
 * MP3 ChunkedEncoder：
 * 每帧喂给 lamejs encodeBuffer，有产出（length > 0）即作为一个 chunk 发出。
 * flush() 时调用 lame flush，返回最后一批 MP3 帧数据。
 *
 * lamejs 内部以 1152 样本为一个 MPEG 帧，通常每帧都有产出。
 * 单声道时 right 通道传与 left 相同的数组。
 */
function createMp3ChunkedEncoder(options?: Mp3ChunkedEncoderOptions): ChunkedEncoder {
  const bitrateKbps = options?.bitrateKbps ?? 128

  // encoder 在第一帧时才初始化，因为需要实际的 sampleRate 和 channels
  let encoder: InstanceType<typeof Mp3EncoderClass> | null = null
  let encoderChannels = 0
  let encoderSampleRate = 0

  function getOrCreateEncoder(channels: number, sampleRate: number) {
    if (
      encoder !== null &&
      encoderChannels === channels &&
      encoderSampleRate === sampleRate
    ) {
      return encoder
    }

    // channels 或 sampleRate 变化时（理论上不应发生）重建
    encoder = new Mp3EncoderClass(channels, sampleRate, bitrateKbps)
    encoderChannels = channels
    encoderSampleRate = sampleRate
    return encoder
  }

  return {
    feedFrame(channels, sampleRate, planar) {
      const enc = getOrCreateEncoder(channels, sampleRate)
      const frameLength = planar[0]?.length ?? 0
      if (frameLength === 0) {
        return null
      }

      const left = planar[0]!
      // 单声道时 right 传 left，lamejs 内部会忽略 right
      const right = channels > 1 ? (planar[1] ?? left) : left

      const int8Result = enc.encodeBuffer(left, right)

      if (int8Result.length === 0) {
        return null
      }

      // lamejs 返回 Int8Array，MP3 是二进制流，消费方按无符号字节处理
      // Uint8Array.from 重新解释 bit pattern（-1 → 255），不做数值转换
      return Uint8Array.from(int8Result)
    },

    flush() {
      if (encoder === null) {
        return null
      }

      const int8Result = encoder.flush()
      encoder = null
      encoderChannels = 0
      encoderSampleRate = 0

      if (int8Result.length === 0) {
        return null
      }

      return Uint8Array.from(int8Result)
    },

    dispose() {
      encoder = null
      encoderChannels = 0
      encoderSampleRate = 0
    },
  }
}

export const mp3ChunkedEncoderDefinition: ChunkedEncoderDefinition<Mp3ChunkedEncoderOptions> =
  {
    format: "mp3",
    create: createMp3ChunkedEncoder,
  }
