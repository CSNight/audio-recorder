import type { StreamEncoder, StreamEncoderDefinition, } from "../../plugins/streaming-export"
import { createWavHeader } from "./wav-header"

/** WAV StreamEncoder 选项 */
export interface WavChunkedEncoderOptions {
  /** 积累多少帧后输出一个带完整 WAV header 的分片，默认 100 帧 */
  framesPerChunk?: number
  /** 位深，默认 16 */
  bitsPerSample?: 16
}

/**
 * WAV StreamEncoder（方案 A）：
 * 每积累 framesPerChunk 帧 PCM，输出一个包含完整 WAV header 的小文件分片。
 * flush() 时若有剩余帧，输出最后一个分片。
 *
 * 支持任意声道数。每个分片都是独立可解码的完整 WAV 文件，消费方可以直接拼接或逐片处理。
 */
function createWavChunkedEncoder(
  options?: WavChunkedEncoderOptions
): StreamEncoder {
  const framesPerChunk = options?.framesPerChunk ?? 100
  const bitsPerSample = options?.bitsPerSample ?? 16
  const bytesPerSample = bitsPerSample / 8

  // 缓冲区，每帧 Int16Array[] 追加进来
  const frameBuffer: Int16Array[][] = []
  // 记录最后一帧的声道数和采样率，flush 时用
  let lastChannels = 1
  let lastSampleRate = 16000

  function buildWavChunk(
    frames: Int16Array[][],
    channels: number,
    sampleRate: number
  ): Uint8Array {
    let totalSamplesPerChannel = 0
    for (const planar of frames) {
      totalSamplesPerChannel += planar[0]?.length ?? 0
    }

    const dataBytes = totalSamplesPerChannel * channels * bytesPerSample
    const header = new Uint8Array(
      createWavHeader({
        dataBytes,
        sampleRate,
        channels,
        bitRate: bitsPerSample,
      })
    )
    const output = new Uint8Array(header.byteLength + dataBytes)
    output.set(header, 0)

    // 写入 interleaved PCM
    const view = new DataView(output.buffer)
    let offset = header.byteLength

    for (const planar of frames) {
      const frameLength = planar[0]?.length ?? 0

      if (channels === 1) {
        // 单声道快速路径
        const ch = planar[0]!
        for (let i = 0; i < frameLength; i++) {
          view.setInt16(offset, ch[i] ?? 0, true)
          offset += 2
        }
      } else if (channels === 2) {
        // 双声道：第二声道缺失时复用第一声道（单声道升混）
        const left = planar[0]!
        const right = planar[1] ?? left
        for (let i = 0; i < frameLength; i++) {
          view.setInt16(offset, left[i] ?? 0, true)
          offset += 2
          view.setInt16(offset, right[i] ?? 0, true)
          offset += 2
        }
      } else {
        // 多声道通用交织逻辑（3+声道，缺失声道补0）
        for (let i = 0; i < frameLength; i++) {
          for (let ch = 0; ch < channels; ch++) {
            const sample = planar[ch]?.[i] ?? 0
            view.setInt16(offset, sample, true)
            offset += 2
          }
        }
      }
    }

    return output
  }

  return {
    feedFrame(channels, sampleRate, planar) {
      lastChannels = channels
      lastSampleRate = sampleRate

      frameBuffer.push(planar.map((ch) => new Int16Array(ch)))

      if (frameBuffer.length >= framesPerChunk) {
        const frames = frameBuffer.splice(0, frameBuffer.length)
        return buildWavChunk(frames, channels, sampleRate)
      }

      return null
    },

    flush() {
      if (frameBuffer.length === 0) {
        return null
      }

      const frames = frameBuffer.splice(0, frameBuffer.length)
      return buildWavChunk(frames, lastChannels, lastSampleRate)
    },

    dispose() {
      frameBuffer.length = 0
    },
  }
}

export const wavStreamEncoder: StreamEncoderDefinition<WavChunkedEncoderOptions> =
  {
    format: "wav",
    create: createWavChunkedEncoder,
  }
