import type { AudioChannelCount } from "@/types"

export interface Mp3ExportOptions {
  /** 比特率（kbps），默认 128 */
  bitrateKbps?: number
  /** 目标采样率（可选重采样），未提供时使用 snapshot 原始采样率 */
  sampleRate?: number
}

export interface Mp3ExportResult {
  sampleRate: number
  channels: AudioChannelCount
  bitrateKbps: number
  durationMs: number
  /** 完整 MP3 文件字节流 */
  data: Uint8Array
}
