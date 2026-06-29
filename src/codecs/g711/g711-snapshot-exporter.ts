/**
 * G.711 全量快照导出。
 *
 * 将完整录音的 PCM 数据编码为 G.711 A-law 或 U-law 字节流。
 * 始终在主线程同步执行。
 *
 * 多声道输入只取第一声道（G.711 为单声道标准）。
 * 可通过 options.sampleRate 指定重采样目标（通常为 8000Hz）。
 */
import type { PcmBufferSnapshot } from "@/buffer/types"
import type { ExportEncoderDefinition } from "@/types"
import { resample } from "@csnight/audio-recorder"
import { encodeAlaw, encodeUlaw } from "./g711-encoder"
import type { G711ExportOptions, G711ExportResult } from "./types"

export function exportG711Snapshot(
  snapshot: PcmBufferSnapshot,
  options: G711ExportOptions = {}
): G711ExportResult {
  const variant = options.variant ?? "alaw"
  const targetSampleRate = options.sampleRate ?? snapshot.sampleRate
  const encodeFn = variant === "ulaw" ? encodeUlaw : encodeAlaw

  const normalized = resample(snapshot, targetSampleRate, {})

  const mono = normalized.planar[0] ?? new Int16Array(0)
  const data = new Uint8Array(mono.length)
  for (let i = 0; i < mono.length; i++) {
    data[i] = encodeFn(mono[i]!)
  }

  return {
    variant,
    sampleRate: normalized.sampleRate,
    channels: 1,
    durationMs: normalized.durationMs,
    data,
  }
}

export const g711ExportEncoder: ExportEncoderDefinition<
  "g711",
  G711ExportOptions,
  G711ExportResult
> = {
  type: "g711",
  export: (snapshot, options) => exportG711Snapshot(snapshot, options),
}
