import type {
  StreamEncoder,
  StreamEncoderDefinition,
} from "../../plugins/streaming-export"

/** PCM StreamEncoder 选项 */
export interface PcmChunkedEncoderOptions {
  /** 位深，默认 16 */
  bitsPerSample?: 8 | 16
}

/**
 * PCM StreamEncoder：每帧直接输出 interleaved PCM，无缓冲累积。
 *
 * 支持任意声道数：
 * - 单声道：直接输出 channel[0] 的样本
 * - 多声道：交错排列所有声道（Ch0_S0, Ch1_S0, Ch2_S0, ..., Ch0_S1, Ch1_S1, ...）
 * - 缺失声道补0
 */
function createPcmChunkedEncoder(
  options?: PcmChunkedEncoderOptions
): StreamEncoder {
  const bitsPerSample = options?.bitsPerSample ?? 16
  const bytesPerSample = bitsPerSample / 8

  return {
    feedFrame(channels, _sampleRate, planar) {
      if (planar.length === 0 || (planar[0]?.length ?? 0) === 0) {
        return null
      }

      const frameLength = planar[0]?.length ?? 0
      const totalSamples = frameLength * channels
      const output = new Uint8Array(totalSamples * bytesPerSample)
      const view = new DataView(output.buffer)

      if (bitsPerSample === 16) {
        if (channels === 1) {
          // 单声道快速路径
          const ch = planar[0]!
          for (let i = 0; i < frameLength; i++) {
            view.setInt16(i * 2, ch[i] ?? 0, true)
          }
        } else if (channels === 2) {
          // 双声道：第二声道缺失时复用第一声道（单声道升混）
          const left = planar[0]!
          const right = planar[1] ?? left
          for (let i = 0; i < frameLength; i++) {
            view.setInt16(i * 4, left[i] ?? 0, true)
            view.setInt16(i * 4 + 2, right[i] ?? 0, true)
          }
        } else {
          // 多声道通用交织逻辑（3+声道，缺失声道补0）
          for (let i = 0; i < frameLength; i++) {
            for (let ch = 0; ch < channels; ch++) {
              const sample = planar[ch]?.[i] ?? 0
              view.setInt16((i * channels + ch) * 2, sample, true)
            }
          }
        }
      } else {
        // 8-bit：Int16 >> 8 + 128 转为无符号 8 位
        if (channels === 1) {
          const ch = planar[0]!
          for (let i = 0; i < frameLength; i++) {
            output[i] = ((ch[i] ?? 0) >> 8) + 128
          }
        } else if (channels === 2) {
          // 双声道：第二声道缺失时复用第一声道
          const left = planar[0]!
          const right = planar[1] ?? left
          for (let i = 0; i < frameLength; i++) {
            output[i * 2] = ((left[i] ?? 0) >> 8) + 128
            output[i * 2 + 1] = ((right[i] ?? 0) >> 8) + 128
          }
        } else {
          // 多声道：缺失声道补0
          for (let i = 0; i < frameLength; i++) {
            for (let ch = 0; ch < channels; ch++) {
              const sample = planar[ch]?.[i] ?? 0
              output[i * channels + ch] = (sample >> 8) + 128
            }
          }
        }
      }

      return output
    },

    flush() {
      // PCM 无内部缓冲，flush 无产出
      return null
    },

    dispose() {
      // 无资源需要释放
    },
  }
}

export const pcmStreamEncoder: StreamEncoderDefinition<PcmChunkedEncoderOptions> =
  {
    format: "pcm",
    create: createPcmChunkedEncoder,
  }
