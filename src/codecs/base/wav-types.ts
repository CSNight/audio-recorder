import type { AudioChannelCount } from "@/types"

/** WAV 一次性导出选项 */
export interface WavExportOptions {
  /** 导出采样率，默认沿用输入 PCM 的采样率；与输入不同时会触发重采样 */
  sampleRate?: number
  /** 导出位深，默认 16 */
  bitRate?: 8 | 16
}

/** WAV 导出结果 */
export interface WavExportResult {
  sampleRate: number
  channels: AudioChannelCount
  bitRate: 8 | 16
  durationMs: number
  mimeType: "audio/wav"
  /** 完整的 WAV 文件数据（含 RIFF/WAVE 文件头） */
  arrayBuffer: ArrayBuffer
  /** 由 arrayBuffer 包装的 Blob，便于下载或上传 */
  blob: Blob
}
