/**
 * Opus 流式（chunked）编码器实现
 *
 * 支持两种容器格式：
 * - "ogg": Opus in OGG container (RFC 7845)
 * - "webm": Opus in WebM container
 *
 * 仅会被两类执行环境加载：
 * 1. Opus 专属 Worker blob 内部（opus-worker.ts 中 import）
 * 2. Worker 不可用时的主线程 fallback 路径（chunked-encoder-bridge.ts 中 import）
 */

import type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
} from "@/plugins/streaming-export/types"
import { createOpusEncoder, preloadOpusModule } from "./opus-wasm-api"
import type { OpusEncoderHandle, OpusEncoderOptions } from "./types"
import { OggMuxer } from "./muxers/ogg"
import { WebmMuxer } from "./muxers/webm"

/** Opus ChunkedEncoder 选项 */
export interface OpusChunkedEncoderOptions extends Partial<OpusEncoderOptions> {
  /** 容器格式（默认: 'ogg'） */
  container?: "ogg" | "webm"
}

/**
 * Opus ChunkedEncoder（OGG 容器）
 *
 * 工作流程：
 * 1. 积累 PCM 样本到 frameSize
 * 2. 调用 Opus 编码器编码为裸 Opus 帧
 * 3. 通过 OGG muxer 封装为 OGG page
 * 4. 返回 page 字节流
 *
 * 前提：调用方须在 create() 之前完成 preload()，确保 WASM 已就绪。
 */
function createOpusOggChunkedEncoder(
  options?: OpusChunkedEncoderOptions
): ChunkedEncoder {
  // 同步创建编码器（WASM 必须已通过 preload() 加载完毕）
  const encoderOptions: OpusEncoderOptions = {
    sampleRate: (options?.sampleRate ?? 48000) as any,
    channels: options?.channels ?? 1,
    bitrate: options?.bitrate ?? 128000,
    application: options?.application ?? "audio",
    complexity: options?.complexity ?? 10,
    vbr: options?.vbr ?? true,
    fec: options?.fec ?? false,
    dtx: options?.dtx ?? false,
    packetLossPercent: options?.packetLossPercent ?? 0,
  }

  // createOpusEncoder is now sync (throws if WASM not preloaded)
  const encoder: OpusEncoderHandle = createOpusEncoder(encoderOptions)
  const frameSize = encoder.frameSize

  // OPUS_GET_LOOKAHEAD is at input sample rate; scale to 48 kHz for pre_skip
  // (RFC 7845 §2.1.2). Formula from opusenc: ceil(lookahead * 48000 / rate)
  const sampleRate = encoderOptions.sampleRate as number
  const preSkip = Math.ceil((encoder.getLookahead() * 48000) / sampleRate)
  const muxer = new OggMuxer({
    sampleRate,
    channels: encoderOptions.channels,
    preSkip,
  })

  // Granule position starts at pre-skip (RFC 7845 §4)
  let granulePosition = BigInt(preSkip)
  let headersSent = false

  // PCM 累积缓冲区
  let pcmBuffer: Int16Array[] = []
  let pcmBufferSamples = 0

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

  return {
    feedFrame(channels, sampleRate, planar) {
      const frameLength = planar[0]?.length ?? 0
      if (frameLength === 0) return null

      // 发送 OGG headers（仅一次）
      let output: Uint8Array | null = null
      if (!headersSent) {
        output = muxer.getHeaderPages()
        headersSent = true
      }

      // 积累 PCM 数据
      for (let ch = 0; ch < channels; ch++) {
        if (!pcmBuffer[ch]) {
          pcmBuffer[ch] = new Int16Array(0)
        }
        const existingBuffer = pcmBuffer[ch]!
        const channelData = planar[ch]!
        const newBuffer = new Int16Array(existingBuffer.length + frameLength)
        newBuffer.set(existingBuffer)
        newBuffer.set(channelData, existingBuffer.length)
        pcmBuffer[ch] = newBuffer
      }
      pcmBufferSamples += frameLength

      // 编码所有完整帧
      const chunks: Uint8Array[] = output ? [output] : []

      while (pcmBufferSamples >= frameSize) {
        // 提取一帧
        const frame = pcmBuffer.map((ch) => ch.subarray(0, frameSize))
        const interleaved = interleave(frame, channels)

        // 编码
        const opusPacket = encoder.encode(interleaved)

        // 更新 granule position（Opus 始终以 48kHz 计算）
        const granuleIncrement = BigInt(
          Math.floor((frameSize * 48000) / sampleRate)
        )
        granulePosition += granuleIncrement

        // 封装为 OGG page
        const oggPage = muxer.writeFrame(opusPacket, granulePosition)
        chunks.push(oggPage)

        // 移除已处理的样本
        pcmBuffer = pcmBuffer.map((ch) => ch.subarray(frameSize))
        pcmBufferSamples -= frameSize
      }

      if (chunks.length === 0) return null

      // 合并所有 chunks
      const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0)
      const result = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }

      return result
    },

    flush() {
      if (!headersSent) return null

      const chunks: Uint8Array[] = []

      if (pcmBufferSamples > 0) {
        // 处理剩余的不完整帧（padding with zeros）
        const paddedBuffer = pcmBuffer.map((ch) => {
          const padded = new Int16Array(frameSize)
          padded.set(ch.subarray(0, Math.min(ch.length, frameSize)))
          return padded
        })

        const interleaved = interleave(paddedBuffer, pcmBuffer.length)
        const opusPacket = encoder.encode(interleaved)

        const granuleIncrement = BigInt(
          Math.floor((frameSize * 48000) / encoder.sampleRate)
        )
        granulePosition += granuleIncrement

        chunks.push(muxer.writeFinalFrame(opusPacket, granulePosition))
      } else {
        // 总样本数恰好是帧大小的整数倍：必须仍然发出带 EOS 标志的 page
        // 用一帧静音作为终结符（RFC 3533 §6 要求 last page 携带 EOS flag）
        const silence = new Int16Array(frameSize * encoder.channels)
        const opusPacket = encoder.encode(silence)
        const granuleIncrement = BigInt(
          Math.floor((frameSize * 48000) / encoder.sampleRate)
        )
        granulePosition += granuleIncrement
        chunks.push(muxer.writeFinalFrame(opusPacket, granulePosition))
      }

      const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0)
      const result = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }

      return result
    },

    dispose() {
      encoder.free()
      pcmBuffer = []
      pcmBufferSamples = 0
      headersSent = false
    },
  }
}

/**
 * Opus ChunkedEncoder（WebM 容器）
 *
 * 前提：调用方须在 create() 之前完成 preload()，确保 WASM 已就绪。
 */
function createOpusWebmChunkedEncoder(
  options?: OpusChunkedEncoderOptions
): ChunkedEncoder {
  const encoderOptions: OpusEncoderOptions = {
    sampleRate: (options?.sampleRate ?? 48000) as any,
    channels: options?.channels ?? 1,
    bitrate: options?.bitrate ?? 128000,
    application: options?.application ?? "audio",
    complexity: options?.complexity ?? 10,
    vbr: options?.vbr ?? true,
    fec: options?.fec ?? false,
    dtx: options?.dtx ?? false,
    packetLossPercent: options?.packetLossPercent ?? 0,
  }

  // createOpusEncoder is now sync (throws if WASM not preloaded)
  const encoder: OpusEncoderHandle = createOpusEncoder(encoderOptions)
  const frameSize = encoder.frameSize
  const sampleRate = encoderOptions.sampleRate as number
  const frameDurationMs = (frameSize / sampleRate) * 1000

  const muxer = new WebmMuxer({
    sampleRate,
    channels: encoderOptions.channels,
    frameDurationMs,
  })

  let headersSent = false
  let pcmBuffer: Int16Array[] = []
  let pcmBufferSamples = 0
  let currentTimestampMs = 0

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

  return {
    feedFrame(channels, _sampleRate, planar) {
      const frameLength = planar[0]?.length ?? 0
      if (frameLength === 0) return null

      let output: Uint8Array | null = null
      if (!headersSent) {
        output = muxer.getHeaders()
        headersSent = true
      }

      // 积累 PCM 数据
      for (let ch = 0; ch < channels; ch++) {
        if (!pcmBuffer[ch]) {
          pcmBuffer[ch] = new Int16Array(0)
        }
        const existingBuffer = pcmBuffer[ch]!
        const channelData = planar[ch]!
        const newBuffer = new Int16Array(existingBuffer.length + frameLength)
        newBuffer.set(existingBuffer)
        newBuffer.set(channelData, existingBuffer.length)
        pcmBuffer[ch] = newBuffer
      }
      pcmBufferSamples += frameLength

      const chunks: Uint8Array[] = output ? [output] : []

      while (pcmBufferSamples >= frameSize) {
        const frame = pcmBuffer.map((ch) => ch.subarray(0, frameSize))
        const interleaved = interleave(frame, channels)

        const opusPacket = encoder.encode(interleaved)
        const webmBlock = muxer.writeFrame(
          opusPacket,
          Math.floor(currentTimestampMs)
        )

        chunks.push(webmBlock)

        currentTimestampMs += frameDurationMs
        pcmBuffer = pcmBuffer.map((ch) => ch.subarray(frameSize))
        pcmBufferSamples -= frameSize
      }

      if (chunks.length === 0) return null

      const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0)
      const result = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }

      return result
    },

    flush() {
      if (!headersSent) return null

      const chunks: Uint8Array[] = []

      if (pcmBufferSamples > 0) {
        const paddedBuffer = pcmBuffer.map((ch) => {
          const padded = new Int16Array(frameSize)
          padded.set(ch.subarray(0, Math.min(ch.length, frameSize)))
          return padded
        })

        const interleaved = interleave(paddedBuffer, pcmBuffer.length)
        const opusPacket = encoder.encode(interleaved)
        const webmBlock = muxer.writeFrame(
          opusPacket,
          Math.floor(currentTimestampMs)
        )

        chunks.push(webmBlock)
      }

      // WebM finalize (usually no-op for streaming)
      const finalData = muxer.finalize()
      if (finalData.length > 0) {
        chunks.push(finalData)
      }

      if (chunks.length === 0) return null

      const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0)
      const result = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.byteLength
      }

      return result
    },

    dispose() {
      encoder.free()
      pcmBuffer = []
      pcmBufferSamples = 0
      headersSent = false
    },
  }
}

export const oggChunkedEncoderDefinition: ChunkedEncoderDefinition<OpusChunkedEncoderOptions> =
  {
    format: "ogg",
    preload: preloadOpusModule,
    create: createOpusOggChunkedEncoder,
  }

export const webmChunkedEncoderDefinition: ChunkedEncoderDefinition<OpusChunkedEncoderOptions> =
  {
    format: "webm",
    preload: preloadOpusModule,
    create: createOpusWebmChunkedEncoder,
  }
