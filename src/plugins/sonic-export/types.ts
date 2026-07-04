import type { PcmBufferSnapshot } from "../../buffer/types"
import type { StreamEncoderDefinition } from "../../types"
import type { RecorderPlugin } from "../types"

export interface SonicTransformOptions {
  /** 变速不变调，默认 1。大于 1 更快，小于 1 更慢。 */
  speed?: number
  /** 变调不变速，默认 1。 */
  pitch?: number
  /** 同时影响速度和音调，默认 1。 */
  rate?: number
  /** 音量倍率，默认 1。 */
  volume?: number
  /** 每次处理的块时长（毫秒），默认 200。 */
  blockMs?: number
}

export interface NormalizedSonicTransformOptions {
  speed: number
  pitch: number
  rate: number
  volume: number
  blockMs: number
}

export type SonicExportFormat = "pcm" | "wav"

export interface SonicExportOptions extends SonicTransformOptions {
  format: SonicExportFormat
  encoders: StreamEncoderDefinition[]
  encoderOptions?: unknown
  allowMainThreadFallback?: boolean
  streamId?: string
  metadata?: Record<string, unknown>
  createStreamId?(): string
  createSessionId?(): string
}

export interface SonicExportPlugin extends RecorderPlugin {
  /**
   * 对录音快照做 Sonic 处理。
   * 多声道快照会先按快照声道数交织，再输出同声道布局的交织 Int16 PCM。
   */
  transformSnapshot(
    snapshot: PcmBufferSnapshot,
    options?: SonicTransformOptions
  ): Promise<Int16Array>

  /**
   * 对任意 PCM 数据做 Sonic 处理。
   * 默认按单声道解释；多声道交织 PCM 需显式传入 channels。
   */
  transform(
    pcm: Int16Array,
    sampleRate: number,
    channelsOrOptions?: number | SonicTransformOptions,
    options?: SonicTransformOptions
  ): Promise<Int16Array>
}
