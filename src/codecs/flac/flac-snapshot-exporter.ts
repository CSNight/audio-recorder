/**
 * FLAC 全量快照导出
 *
 * 与 pcm-exporter.ts / wav-exporter.ts / mp3-snapshot-exporter.ts 角色完全对称：
 * 输入 PcmBufferSnapshot（完整录音数据），输出单个连续 Uint8Array（完整 FLAC 文件）。
 *
 * 始终在主线程同步执行，不经过 Worker（snapshot 已是完整数据，无"实时流"语义）。
 */

import type { PcmBufferSnapshot } from "../../buffer/types"
import type { ExportEncoderDefinition } from "../../types"
import { resample } from "@media-studio/audio-recorder"
import { createFlacEncoder, preloadFlacModule } from "./flac-wasm-api"
import { isSupportSampleRate, resolveExportSampleRate } from "./sample-rate"
import type {
  FlacEncoderOptions,
  FlacExportOptions,
  FlacExportResult,
} from "./types"

/**
 * 交织 planar PCM 数据
 */
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

/**
 * 导出 FLAC 快照
 */
export function exportFlacSnapshot(
  snapshot: PcmBufferSnapshot,
  options: FlacExportOptions = {}
): FlacExportResult {
  const targetSampleRate = resolveExportSampleRate(
    options.sampleRate,
    snapshot.sampleRate
  )
  const normalized =
    targetSampleRate === snapshot.sampleRate
      ? snapshot
      : resample(snapshot, targetSampleRate, { isHQ: !!options.isHQ })
  const { sampleRate, channels, planar } = normalized

  // 创建 FLAC 编码器
  const encoderOptions: FlacEncoderOptions = {
    sampleRate,
    channels,
    bitsPerSample: options.bitsPerSample ?? 16,
    compressionLevel: options.compressionLevel ?? 5,
    totalSamplesEstimate: planar[0]?.length ?? 0,
  }

  const encoder = createFlacEncoder(encoderOptions)

  const chunks: Uint8Array[] = []

  // FLAC 可以一次性编码所有数据，也可以分块
  // 为了避免单次分配过大内存，我们分块处理（每块最多 16384 样本）
  const CHUNK_SIZE = 16384
  const totalSamples = planar[0]?.length ?? 0

  for (let offset = 0; offset < totalSamples; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, totalSamples)
    const chunkLength = end - offset

    // 提取一块数据
    const chunkPlanar = planar.map((ch) => ch.subarray(offset, end))
    const interleaved = interleave(chunkPlanar, channels)

    // 编码
    const flacBytes = encoder.encode(interleaved, chunkLength)
    if (flacBytes.length > 0) {
      chunks.push(flacBytes)
    }
  }

  // Flush 获取最终数据（包含更新的 STREAMINFO）
  const finalBytes = encoder.flush()
  if (finalBytes.length > 0) {
    chunks.push(finalBytes)
  }

  encoder.free()

  // 合并所有 chunks
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const data = new Uint8Array(totalBytes)
  let pos = 0
  for (const chunk of chunks) {
    data.set(chunk, pos)
    pos += chunk.byteLength
  }

  return {
    data,
    mimeType: "audio/flac",
    sampleRate,
    channels,
    bitsPerSample: encoderOptions.bitsPerSample ?? 16,
  }
}

export const flacExportEncoder: ExportEncoderDefinition<
  "flac",
  FlacExportOptions,
  FlacExportResult
> = {
  type: "flac",
  isSupportSampleRate,
  preload: preloadFlacModule,
  export: (snapshot, options) => exportFlacSnapshot(snapshot, options),
}
