/** G.711 编码变体：alaw（A律，欧洲/中国标准）或 ulaw（μ律，北美/日本标准） */
export type G711Variant = "alaw" | "ulaw"

/** G.711 流式（chunked）编码器选项 */
export interface G711ChunkedEncoderOptions {
  /** 编码变体，默认 "ulaw" */
  variant?: G711Variant
}

/** G.711 一次性快照导出选项 */
export interface G711ExportOptions {
  /** 编码变体，默认 "ulaw" */
  variant?: G711Variant
  /** 输出采样率；G.711 标准为 8000 Hz，省略时沿用输入采样率 */
  sampleRate?: number
}

/** G.711 导出结果 */
export interface G711ExportResult {
  /** 实际使用的编码变体 */
  variant: G711Variant
  /** 编码采样率（Hz） */
  sampleRate: number
  /** G.711 仅支持单声道 */
  channels: 1
  /** 音频时长（毫秒） */
  durationMs: number
  /** 编码后的 G.711 裸字节流（无文件头） */
  data: Uint8Array
}
