/**
 * FLAC 流式（chunked）编码器实现
 *
 * 仅会被两类执行环境加载：
 * 1. FLAC 专属 Worker blob 内部（flac-worker.ts 中 import）
 * 2. Worker 不可用时的主线程 fallback 路径（chunked-encoder-bridge.ts 中 import）
 */

import type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
} from "@/plugins/streaming-export/types"
import { createFlacEncoder } from "./flac-wasm-api"
import type { FlacEncoderHandle, FlacEncoderOptions } from "./types"

/** FLAC ChunkedEncoder 选项 */
export interface FlacChunkedEncoderOptions extends Partial<FlacEncoderOptions> {
  /** Bits per sample (default: 16) */
  bitsPerSample?: 8 | 12 | 16 | 20 | 24 | 32
  /** Compression level (default: 5) */
  compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}

/**
 * FLAC ChunkedEncoder
 *
 * 工作流程：
 * 1. 接收 PCM planar 数据
 * 2. 交织为 interleaved 格式
 * 3. 调用 FLAC 编码器编码
 * 4. 返回 FLAC 帧字节流
 *
 * 注意：FLAC 没有固定帧大小要求，可以灵活编码任意长度
 */
function createFlacChunkedEncoder(
  options?: FlacChunkedEncoderOptions
): ChunkedEncoder {
  let encoder: FlacEncoderHandle | null = null
  let initialized = false

  async function ensureInitialized(
    channels: number,
    sampleRate: number
  ): Promise<void> {
    if (initialized) return

    const encoderOptions: FlacEncoderOptions = {
      sampleRate,
      channels,
      bitsPerSample: options?.bitsPerSample ?? 16,
      compressionLevel: options?.compressionLevel ?? 5,
    }

    encoder = await createFlacEncoder(encoderOptions)
    initialized = true
  }

  function interleave(planar: Int16Array[], channels: number): Int16Array {
    const frameLength = planar[0]?.length ?? 0
    const interleaved = new Int16Array(frameLength * channels)

    for (let i = 0; i < frameLength; i++) {
      for (let ch = 0; ch < channels; ch++) {
        interleaved[i * channels + ch] = planar[ch]?.[i] ?? 0
      }
    }

    return interleaved
  }

  return {
    feedFrame(channels, sampleRate, planar) {
      const frameLength = planar[0]?.length ?? 0
      if (frameLength === 0) return null

      // 异步初始化（第一帧）
      if (!initialized) {
        ensureInitialized(channels, sampleRate).catch((err) => {
          console.error("Failed to initialize FLAC encoder:", err)
        })
        return null
      }

      if (!encoder) return null

      // 交织 PCM 数据
      const interleaved = interleave(planar, channels)

      // 编码
      const flacBytes = encoder.encode(interleaved, frameLength)

      return flacBytes.length > 0 ? flacBytes : null
    },

    flush() {
      if (!encoder) return null

      // Flush 会返回包含更新后的 STREAMINFO 的最终数据
      const flacBytes = encoder.flush()
      return flacBytes.length > 0 ? flacBytes : null
    },

    dispose() {
      if (encoder) {
        encoder.free()
        encoder = null
      }
      initialized = false
    },
  }
}

export const flacChunkedEncoderDefinition: ChunkedEncoderDefinition<FlacChunkedEncoderOptions> =
  {
    format: "flac",
    create: createFlacChunkedEncoder,
  }
