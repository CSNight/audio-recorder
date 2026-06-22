/**
 * MP3 流式（chunked）编码器实现。
 *
 * 仅会被两类执行环境加载：
 * 1. MP3 专属 Worker blob 内部（mp3-worker.ts 中 import）
 * 2. Worker 不可用时的主线程 fallback 路径（chunked-encoder-bridge.ts 中 import）
 *
 * 不会被主包（src/index.ts）间接引用，因此不会把 lamejs 拖入主 bundle。
 */
import type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
} from "@/plugins/streaming-export/types"
import { Mp3Encoder } from "./vendor/lame.all.js"
import type { LameMp3Encoder } from "./types"

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
 * 双声道时取 planar[1] 作为 right；单声道时 right 通道传与 left 相同的数组
 * （lamejs 内部按 mono 处理时忽略 right 参数，但仍需传入避免 undefined）。
 */
function createMp3ChunkedEncoder(
  options?: Mp3ChunkedEncoderOptions
): ChunkedEncoder {
  const bitrateKbps = options?.bitrateKbps ?? 128

  // encoder 在第一帧时才初始化，因为需要实际的 sampleRate 和 channels
  let encoder: LameMp3Encoder | null = null
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
    encoder = new Mp3Encoder(
      channels,
      sampleRate,
      bitrateKbps
    ) as unknown as LameMp3Encoder
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
      // MP3 只支持单声道/双声道。对于多声道音频，降混到双声道：
      // - 单声道：right = left（lamejs 内部会忽略）
      // - 双声道：使用原始的 left/right
      // - 3+ 声道：left = planar[0], right = planar[1]（取前两个声道）
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
