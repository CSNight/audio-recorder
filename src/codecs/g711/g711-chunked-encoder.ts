/**
 * G.711 流式（chunked）编码器。
 *
 * G.711 每帧处理：取第一声道（单声道）逐样本编码，无缓冲延迟，
 * feedFrame 总是立即输出对应字节数。
 *
 * 多声道输入只取 planar[0]；不支持重采样（由外层按需处理）。
 */
import type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
} from "@/plugins/streaming-export/types"
import { encodeAlaw, encodeUlaw } from "./g711-encoder"
import type { G711ChunkedEncoderOptions } from "./types"

function createG711ChunkedEncoder(
  options?: G711ChunkedEncoderOptions
): ChunkedEncoder {
  const encodeFn = options?.variant === "ulaw" ? encodeUlaw : encodeAlaw

  return {
    feedFrame(_channels, _sampleRate, planar) {
      const mono = planar[0]
      if (!mono || mono.length === 0) {
        return null
      }

      const out = new Uint8Array(mono.length)
      for (let i = 0; i < mono.length; i++) {
        out[i] = encodeFn(mono[i]!)
      }
      return out
    },

    flush() {
      return null
    },

    dispose() {
      // 无状态，无需清理
    },
  }
}

export const g711ChunkedEncoderDefinition: ChunkedEncoderDefinition<G711ChunkedEncoderOptions> =
  {
    format: "g711",
    create: createG711ChunkedEncoder,
  }
