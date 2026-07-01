/** PCM 一次性导出选项 */
export interface PcmExportOptions {
  /** 导出采样率，默认沿用输入 PCM 的采样率；与输入不同时会触发重采样 */
  sampleRate?: number
  /** 导出位深，默认 16 */
  bitRate?: 8 | 16
  /** 是否使用高保真重采样算法，默认 false（仅 sampleRate 触发重采样时生效） */
  isHQ?: boolean
}

export interface PcmExportResult {
  sampleRate: number
  channels: number
  bitRate: 8 | 16
  durationMs: number
  /**
   * 16-bit 为有符号 `Int16Array`；8-bit 为**有符号** `Int8Array`（范围 -128..127）。
   * 注意与 WAV 导出不同：WAV 内的 8-bit PCM 按标准存为无符号字节（0..255）。
   */
  data: Int16Array | Int8Array
}
