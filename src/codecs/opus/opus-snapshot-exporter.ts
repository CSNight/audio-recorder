/**
 * Opus 全量快照导出
 *
 * 与 pcm-exporter.ts / wav-exporter.ts / mp3-snapshot-exporter.ts 角色完全对称：
 * 输入 PcmBufferSnapshot（完整录音数据），输出单个连续 Uint8Array（完整 Opus 文件）。
 *
 * 支持两种容器格式：
 * - OGG: Opus in OGG container (RFC 7845)
 * - WebM: Opus in WebM container
 *
 * 始终在主线程同步执行，不经过 Worker（snapshot 已是完整数据，无"实时流"语义）。
 */

import type { PcmBufferSnapshot } from "@/buffer/types"
import type { SnapshotEncoderDefinition } from "@/types"
import { createOpusEncoder } from "./opus-wasm-api"
import { OggMuxer } from "./muxers/ogg"
import { WebmMuxer } from "./muxers/webm"
import type {
  OpusEncoderOptions,
  OpusExportOptions,
  OpusExportResult,
} from "./types"

/**
 * 交织 planar PCM 数据
 */
function interleave(planar: Int16Array[], channels: number): Int16Array {
  const frameLength = planar[0]?.length ?? 0
  const interleaved = new Int16Array(frameLength * channels)

  for (let i = 0; i < frameLength; i++) {
    for (let ch = 0; ch < channels; ch++) {
      interleaved[i * channels + ch] = planar[ch]?.[i] ?? 0
    }
  }

  return interleaved
}

/**
 * 导出为 OGG 容器格式
 */
async function exportOpusOgg(
  snapshot: PcmBufferSnapshot,
  options: OpusExportOptions = {}
): Promise<OpusExportResult> {
  const { sampleRate, channels, planar } = snapshot

  // 创建 Opus 编码器
  const encoderOptions: OpusEncoderOptions = {
    sampleRate: sampleRate as any,
    channels,
    bitrate: options.bitrate ?? 128000,
    application: options.application ?? "audio",
    complexity: options.complexity ?? 10,
    vbr: options.vbr ?? true,
    fec: options.fec ?? false,
    dtx: options.dtx ?? false,
    packetLossPercent: options.packetLossPercent ?? 0,
  }

  const encoder = await createOpusEncoder(encoderOptions)
  const frameSize = encoder.frameSize

  // OPUS_GET_LOOKAHEAD returns samples at the encoder's input sample rate.
  // pre_skip must be in 48 kHz samples (RFC 7845 §2.1.2), so scale accordingly.
  // Reference: opusenc.c — `pre_skip = ceil(lookahead * 48000.0 / rate)`
  const preSkipValue =
    options.preSkip ?? Math.ceil((encoder.getLookahead() * 48000) / sampleRate)

  // 创建 OGG muxer
  const muxer = new OggMuxer({
    sampleRate,
    channels,
    preSkip: preSkipValue,
  })

  const chunks: Uint8Array[] = []

  // 写入 OGG headers
  chunks.push(muxer.getHeaderPages())

  // Granule position starts at pre-skip (RFC 7845 §4)
  let granulePosition = BigInt(preSkipValue)
  const totalSamples = planar[0]?.length ?? 0

  for (let offset = 0; offset < totalSamples; offset += frameSize) {
    const frame = planar.map((ch) => ch.subarray(offset, offset + frameSize))

    // 不足一帧时 padding
    const paddedFrame = frame.map((ch) => {
      if (ch.length === frameSize) return ch
      const padded = new Int16Array(frameSize)
      padded.set(ch)
      return padded
    })

    const interleaved = interleave(paddedFrame, channels)
    const opusPacket = encoder.encode(interleaved)

    // 更新 granule position（Opus 始终以 48kHz 计算）
    const granuleIncrement = BigInt(
      Math.floor((frameSize * 48000) / sampleRate)
    )
    granulePosition += granuleIncrement

    // 最后一帧带 EOS 标志
    const isLastFrame = offset + frameSize >= totalSamples
    const oggPage = isLastFrame
      ? muxer.writeFinalFrame(opusPacket, granulePosition)
      : muxer.writeFrame(opusPacket, granulePosition)

    chunks.push(oggPage)
  }

  encoder.free()

  // 合并所有 chunks
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const data = new Uint8Array(totalBytes)
  let pos = 0
  for (const chunk of chunks) {
    data.set(chunk, pos)
    pos += chunk.byteLength
  }

  return {
    data,
    mimeType: "audio/ogg; codecs=opus",
    sampleRate,
    channels,
  }
}

/**
 * 导出为 WebM 容器格式
 */
async function exportOpusWebm(
  snapshot: PcmBufferSnapshot,
  options: OpusExportOptions = {}
): Promise<OpusExportResult> {
  const { sampleRate, channels, planar } = snapshot

  // 创建 Opus 编码器
  const encoderOptions: OpusEncoderOptions = {
    sampleRate: sampleRate as any,
    channels,
    bitrate: options.bitrate ?? 128000,
    application: options.application ?? "audio",
    complexity: options.complexity ?? 10,
    vbr: options.vbr ?? true,
    fec: options.fec ?? false,
    dtx: options.dtx ?? false,
    packetLossPercent: options.packetLossPercent ?? 0,
  }

  const encoder = await createOpusEncoder(encoderOptions)
  const frameSize = encoder.frameSize
  const frameDurationMs = (frameSize / sampleRate) * 1000

  // 创建 WebM muxer
  const muxer = new WebmMuxer({
    sampleRate,
    channels,
    frameDurationMs,
  })

  const chunks: Uint8Array[] = []

  // 写入 WebM headers
  chunks.push(muxer.getHeaders())

  // 编码所有帧
  let currentTimestampMs = 0
  const totalSamples = planar[0]?.length ?? 0

  for (let offset = 0; offset < totalSamples; offset += frameSize) {
    const frame = planar.map((ch) => ch.subarray(offset, offset + frameSize))

    // 不足一帧时 padding
    const paddedFrame = frame.map((ch) => {
      if (ch.length === frameSize) return ch
      const padded = new Int16Array(frameSize)
      padded.set(ch)
      return padded
    })

    const interleaved = interleave(paddedFrame, channels)
    const opusPacket = encoder.encode(interleaved)

    const webmBlock = muxer.writeFrame(
      opusPacket,
      Math.floor(currentTimestampMs)
    )
    chunks.push(webmBlock)

    currentTimestampMs += frameDurationMs
  }

  // Finalize WebM
  const finalData = muxer.finalize()
  if (finalData.length > 0) {
    chunks.push(finalData)
  }

  encoder.free()

  // 合并所有 chunks
  const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0)
  const data = new Uint8Array(totalBytes)
  let pos = 0
  for (const chunk of chunks) {
    data.set(chunk, pos)
    pos += chunk.byteLength
  }

  return {
    data,
    mimeType: "audio/webm; codecs=opus",
    sampleRate,
    channels,
  }
}

/**
 * 导出 Opus 快照（根据 container 选项选择格式）
 */
export async function exportOpusSnapshot(
  snapshot: PcmBufferSnapshot,
  options: OpusExportOptions = {}
): Promise<OpusExportResult> {
  const container = options.container ?? "ogg"

  if (container === "webm") {
    return exportOpusWebm(snapshot, options)
  } else {
    return exportOpusOgg(snapshot, options)
  }
}

export const opusOggSnapshotEncoderDefinition: SnapshotEncoderDefinition<
  "opus-ogg",
  OpusExportOptions,
  OpusExportResult
> = {
  type: "opus-ogg",
  export: async (snapshot, options) =>
    await exportOpusSnapshot(snapshot, { ...options, container: "ogg" }),
}

export const opusWebmSnapshotEncoderDefinition: SnapshotEncoderDefinition<
  "opus-webm",
  OpusExportOptions,
  OpusExportResult
> = {
  type: "opus-webm",
  export: async (snapshot, options) =>
    await exportOpusSnapshot(snapshot, { ...options, container: "webm" }),
}
