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
import { createFlacEncoder, preloadFlacModule } from "./flac-wasm-api"
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
 * 前提：调用 create() 前必须已调用 preloadFlacModule()（由 plugin.setup() 或 exportEncoded() 保证）
 */
function createFlacChunkedEncoder(
  options?: FlacChunkedEncoderOptions,
  channels?: number,
  sampleRate?: number
): ChunkedEncoder {
  // create() 时 WASM 必须已加载（由 preload 保证）
  const encoderOptions: FlacEncoderOptions = {
    sampleRate: sampleRate ?? 48000,
    channels: channels ?? 1,
    bitsPerSample: options?.bitsPerSample ?? 16,
    compressionLevel: options?.compressionLevel ?? 5,
  }

  const encoder: FlacEncoderHandle = createFlacEncoder(encoderOptions)

  function interleave(planar: Int16Array[], ch: number): Int16Array {
    const frameLength = planar[0]?.length ?? 0
    const interleaved = new Int16Array(frameLength * ch)

    for (let i = 0; i < frameLength; i++) {
      for (let c = 0; c < ch; c++) {
        interleaved[i * ch + c] = planar[c]?.[i] ?? 0
      }
    }

    return interleaved
  }

  return {
    feedFrame(_channels, _sampleRate, planar) {
      const frameLength = planar[0]?.length ?? 0
      if (frameLength === 0) return null

      // 交织 PCM 数据
      const interleaved = interleave(planar, _channels)

      // 编码
      const flacBytes = encoder.encode(interleaved, frameLength)

      return flacBytes.length > 0 ? flacBytes : null
    },

    flush() {
      // Flush 会返回包含更新后的 STREAMINFO 的最终数据
      const flacBytes = encoder.flush()
      return flacBytes.length > 0 ? flacBytes : null
    },

    dispose() {
      encoder.free()
    },
  }
}

export const flacChunkedEncoderDefinition: ChunkedEncoderDefinition<FlacChunkedEncoderOptions> =
  {
    format: "flac",
    preload: preloadFlacModule,
    create: createFlacChunkedEncoder,
  }
