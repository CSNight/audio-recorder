import type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
} from "@/plugins/streaming-export/types"

/** PCM ChunkedEncoder 选项 */
export interface PcmChunkedEncoderOptions {
  /** 位深，默认 16 */
  bitsPerSample?: 8 | 16
}

/**
 * PCM ChunkedEncoder：每帧直接输出 interleaved PCM，无缓冲累积。
 *
 * 单声道：直接输出 channel[0] 的样本。
 * 双声道：交错排列 L/R 样本（L0, R0, L1, R1, ...）。
 */
function createPcmChunkedEncoder(
  options?: PcmChunkedEncoderOptions
): ChunkedEncoder {
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
          const ch = planar[0]!
          for (let i = 0; i < frameLength; i++) {
            view.setInt16(i * 2, ch[i] ?? 0, true)
          }
        } else {
          // 双声道 interleaved
          const left = planar[0]!
          const right = planar[1] ?? planar[0]!
          for (let i = 0; i < frameLength; i++) {
            view.setInt16(i * 2 * 2, left[i] ?? 0, true)
            view.setInt16((i * 2 + 1) * 2, right[i] ?? 0, true)
          }
        }
      } else {
        // 8-bit：Int16 >> 8 + 128 转为无符号 8 位
        if (channels === 1) {
          const ch = planar[0]!
          for (let i = 0; i < frameLength; i++) {
            output[i] = ((ch[i] ?? 0) >> 8) + 128
          }
        } else {
          const left = planar[0]!
          const right = planar[1] ?? planar[0]!
          for (let i = 0; i < frameLength; i++) {
            output[i * 2] = ((left[i] ?? 0) >> 8) + 128
            output[i * 2 + 1] = ((right[i] ?? 0) >> 8) + 128
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

export const pcmChunkedEncoderDefinition: ChunkedEncoderDefinition<PcmChunkedEncoderOptions> =
  {
    format: "pcm",
    create: createPcmChunkedEncoder,
  }
