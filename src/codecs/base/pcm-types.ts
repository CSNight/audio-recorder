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
  mimeType: string
  /**
   * 位深：8 或 16。
   * 描述 `data` 字节流的编码方式：
   * - `16`：每两个字节为一个有符号小端 Int16 样本（范围 -32768..32767）。
   * - `8`：每个字节为一个有符号 Int8 样本（范围 -128..127）。
   *   注意与 WAV 不同：WAV 内的 8-bit PCM 按标准存为无符号字节（0..255）。
   * 如需按样本操作，可用 `new Int16Array(data.buffer)` 或 `new Int8Array(data.buffer)`。
   */
  bitRate: 8 | 16
  durationMs: number
  /** 交织（interleaved）裸 PCM 字节流，编码方式见 `bitRate` 字段说明。 */
  data: Uint8Array
}
