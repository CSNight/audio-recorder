/** AMR 频带模式：nb = AMR-NB（窄带，8 kHz），wb = AMR-WB（宽带，16 kHz） */
export type AmrBandMode = "nb" | "wb"

/** AMR 编码器选项 */
export interface AmrExportOptions {
  /** 频带模式，默认 "nb"（AMR-NB） */
  bandMode?: AmrBandMode
}

/** AMR 导出结果 */
export interface AmrExportResult {
  /** 编码后的 AMR 二进制数据 */
  data: Uint8Array
  /** MIME 类型，如 "audio/amr" 或 "audio/amr-wb" */
  mimeType: string
  bandMode: AmrBandMode
  sampleRate: 8000 | 16000
  channels: 1
  durationMs: number
}

/** AMR WASM 编码器实例句柄 */
export interface AmrEncoderHandle {
  readonly bandMode: AmrBandMode
  readonly sampleRate: 8000 | 16000
  /** AMR 每帧固定样本数：NB=160，WB=320 */
  readonly frameSize: 160 | 320
  encode(frame: Int16Array): Uint8Array
  free(): void
}
