/**
 * MP3 全量快照导出。
 *
 * 与 pcm-exporter.ts / wav-exporter.ts 角色完全对称：
 * 输入 PcmBufferSnapshot（完整录音数据），输出单个连续 Uint8Array（完整 MP3 文件）。
 *
 * 始终在主线程同步执行，不经过 Worker（snapshot 已是完整数据，无"实时流"语义）。
 */
import type { PcmBufferSnapshot } from "@/buffer/types"
import { resample } from "@/utils/resample"
import { Mp3Encoder } from "./vendor/lame.all.js"
import type { LameMp3Encoder, LameMp3EncoderConstructor } from "./types"
import type { Mp3ExportOptions, Mp3ExportResult } from "./mp3-snapshot-types"

/** lamejs 标准 MPEG 帧大小（每帧 1152 样本） */
const MPEG_FRAME_SIZE = 1152

export function exportMp3Snapshot(
  snapshot: PcmBufferSnapshot,
  options: Mp3ExportOptions = {}
): Mp3ExportResult {
  const bitrateKbps = options.bitrateKbps ?? 128
  const targetSampleRate = options.sampleRate ?? snapshot.sampleRate

  // 可选重采样
  const normalized = resample(snapshot, targetSampleRate, {})

  const { sampleRate, channels, durationMs } = normalized
  const left = normalized.planar[0] ?? new Int16Array(0)
  // MP3 只支持单声道/双声道。对于多声道音频：
  // - 单声道：right 复用 left（lamejs mono 模式会忽略 right）
  // - 双声道：使用原始的 left/right
  // - 3+ 声道：取前两个声道作为 left/right
  const right = channels > 1 ? (normalized.planar[1] ?? left) : left

  // lamejs 只接受 1 或 2 作为 channels 参数
  const mp3Channels = Math.min(channels, 2)

  const encoder = new (Mp3Encoder as unknown as LameMp3EncoderConstructor)(
    mp3Channels,
    sampleRate,
    bitrateKbps
  ) as LameMp3Encoder

  const chunks: Uint8Array[] = []
  const totalSamples = left.length

  for (let offset = 0; offset < totalSamples; offset += MPEG_FRAME_SIZE) {
    const l = left.subarray(offset, offset + MPEG_FRAME_SIZE)
    const r = right.subarray(offset, offset + MPEG_FRAME_SIZE)
    const encoded = encoder.encodeBuffer(l, r)
    if (encoded.length > 0) {
      chunks.push(Uint8Array.from(encoded))
    }
  }

  // 冲刷末尾残余帧
  const flushed = encoder.flush()
  if (flushed.length > 0) {
    chunks.push(Uint8Array.from(flushed))
  }

  // 合并所有分片为单个连续 Uint8Array
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const data = new Uint8Array(totalBytes)
  let pos = 0
  for (const chunk of chunks) {
    data.set(chunk, pos)
    pos += chunk.byteLength
  }

  return {
    sampleRate,
    channels: mp3Channels as 1 | 2,
    bitrateKbps,
    durationMs,
    data,
  }
}
