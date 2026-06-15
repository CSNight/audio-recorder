import type { AudioChannelCount } from "@/types"

export interface PcmExportOptions {
  sampleRate?: number
  bitRate?: 8 | 16
  isHQ?: boolean
}

export interface PcmExportResult {
  sampleRate: number
  channels: AudioChannelCount
  bitRate: 8 | 16
  durationMs: number
  /**
   * 16-bit 为有符号 `Int16Array`；8-bit 为**有符号** `Int8Array`（范围 -128..127）。
   * 注意与 WAV 导出不同：WAV 内的 8-bit PCM 按标准存为无符号字节（0..255）。
   */
  data: Int16Array | Int8Array
}
