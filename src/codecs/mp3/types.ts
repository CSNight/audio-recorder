/** MP3 码率控制模式 */
export type Mp3RateMode = "cbr" | "abr" | "vbr"

/** MP3 声道模式 */
export type Mp3ChannelMode = "mono" | "stereo" | "joint-stereo"

/** MP3 编码器支持的标准采样率 */
export type Mp3SampleRate =
  | 8000
  | 11025
  | 12000
  | 16000
  | 22050
  | 24000
  | 32000
  | 44100
  | 48000

/** MP3 编码器选项 */
export interface Mp3ExportOptions {
  /** 比特率，单位 kbps；CBR / ABR 模式下生效，默认 128 */
  bitrateKbps?: number
  /** 码率控制模式，默认 cbr */
  mode?: Mp3RateMode
  /** VBR 质量，0 到 9，数值越小质量越高、码率越大，默认 4 */
  vbrQuality?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /** 编码采样率，默认沿用输入 PCM 的采样率 */
  sampleRate?: Mp3SampleRate
  /** 声道模式，默认按输入声道数自动判断：单声道为 mono，否则为 stereo */
  channelMode?: Mp3ChannelMode
  /** LAME 编码质量，0 到 9，数值越小质量越高，默认 2 */
  quality?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  /** 是否使用高保真重采样算法，默认 false（仅 sampleRate 触发重采样时生效） */
  isHQ?: boolean
}

/** 解析补全默认值后的完整 MP3 编码选项 */
export interface ResolvedMp3EncoderOptions {
  bitrateKbps: number
  mode: Mp3RateMode
  vbrQuality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  sampleRate: Mp3SampleRate
  channelMode: Mp3ChannelMode
  quality: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
}

/** MP3 WASM 编码器实例句柄 */
export interface Mp3WasmEncoderHandle {
  sampleRate: Mp3SampleRate
  channels: 1 | 2
  encode(left: Int16Array, right: Int16Array, sampleCount: number): Uint8Array
  flush(): Uint8Array
  free(): void
}

export interface Mp3ExportResult {
  sampleRate: Mp3SampleRate
  channels: 1 | 2
  bitrateKbps: number
  durationMs: number
  /** 编码后的 MP3 二进制数据 */
  data: Uint8Array
}
