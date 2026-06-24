/**
 * Opus 流式（chunked）编码器实现
 *
 * 支持两种容器格式：
 * - "opus-ogg": Opus in OGG container (RFC 7845)
 * - "opus-webm": Opus in WebM container
 *
 * 仅会被两类执行环境加载：
 * 1. Opus 专属 Worker blob 内部（opus-worker.ts 中 import）
 * 2. Worker 不可用时的主线程 fallback 路径（chunked-encoder-bridge.ts 中 import）
 */

import type {
  ChunkedEncoder,
  ChunkedEncoderDefinition,
} from "@/plugins/streaming-export/types"
import { createOpusEncoder } from "./opus-wasm-api"
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
 */
function createOpusOggChunkedEncoder(
  options?: OpusChunkedEncoderOptions
): ChunkedEncoder {
  let encoder: OpusEncoderHandle | null = null
  let muxer: OggMuxer | null = null
  let initialized = false
  let headersSent = false

  // PCM 累积缓冲区
  let pcmBuffer: Int16Array[] = []
  let pcmBufferSamples = 0

  // 编码状态
  // Granule position starts at pre-skip (RFC 7845 §4)
  let granulePosition = 0n
  let preSkip = 312
  let frameSize = 0

  async function ensureInitialized(
    channels: number,
    sampleRate: number
  ): Promise<void> {
    if (initialized) return

    // 创建 Opus 编码器
    const encoderOptions: OpusEncoderOptions = {
      sampleRate: sampleRate as any,
      channels,
      bitrate: options?.bitrate ?? 128000,
      application: options?.application ?? "audio",
      complexity: options?.complexity ?? 10,
      vbr: options?.vbr ?? true,
      fec: options?.fec ?? false,
      dtx: options?.dtx ?? false,
      packetLossPercent: options?.packetLossPercent ?? 0,
    }

    encoder = await createOpusEncoder(encoderOptions)
    frameSize = encoder.frameSize

    // OPUS_GET_LOOKAHEAD is at input sample rate; scale to 48 kHz for pre_skip
    // (RFC 7845 §2.1.2). Formula from opusenc: ceil(lookahead * 48000 / rate)
    preSkip = Math.ceil((encoder.getLookahead() * 48000) / sampleRate)
    muxer = new OggMuxer({
      sampleRate,
      channels,
      preSkip,
    })

    // Granule position starts at pre-skip (first decoded sample is at position pre-skip)
    granulePosition = BigInt(preSkip)

    initialized = true
  }

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

      // 异步初始化（第一帧）
      if (!initialized) {
        ensureInitialized(channels, sampleRate).catch((err) => {
          console.error("Failed to initialize Opus encoder:", err)
        })
        // 按 channel 累积，避免多帧到达时数据错位
        for (let ch = 0; ch < channels; ch++) {
          const incoming = planar[ch]!
          if (!pcmBuffer[ch]) {
            pcmBuffer[ch] = incoming.slice()
          } else {
            const existing = pcmBuffer[ch]!
            const merged = new Int16Array(existing.length + incoming.length)
            merged.set(existing)
            merged.set(incoming, existing.length)
            pcmBuffer[ch] = merged
          }
        }
        pcmBufferSamples += frameLength
        return null
      }

      if (!encoder || !muxer) return null

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
      if (!encoder || !muxer || !headersSent) return null

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
      if (encoder) {
        encoder.free()
        encoder = null
      }
      muxer = null
      pcmBuffer = []
      pcmBufferSamples = 0
      initialized = false
      headersSent = false
    },
  }
}

/**
 * Opus ChunkedEncoder（WebM 容器）
 */
function createOpusWebmChunkedEncoder(
  options?: OpusChunkedEncoderOptions
): ChunkedEncoder {
  let encoder: OpusEncoderHandle | null = null
  let muxer: WebmMuxer | null = null
  let initialized = false
  let headersSent = false

  let pcmBuffer: Int16Array[] = []
  let pcmBufferSamples = 0

  let currentTimestampMs = 0
  let frameSize = 0
  let frameDurationMs = 0

  async function ensureInitialized(
    channels: number,
    sampleRate: number
  ): Promise<void> {
    if (initialized) return

    const encoderOptions: OpusEncoderOptions = {
      sampleRate: sampleRate as any,
      channels,
      bitrate: options?.bitrate ?? 128000,
      application: options?.application ?? "audio",
      complexity: options?.complexity ?? 10,
      vbr: options?.vbr ?? true,
      fec: options?.fec ?? false,
      dtx: options?.dtx ?? false,
      packetLossPercent: options?.packetLossPercent ?? 0,
    }

    encoder = await createOpusEncoder(encoderOptions)
    frameSize = encoder.frameSize
    frameDurationMs = (frameSize / sampleRate) * 1000

    muxer = new WebmMuxer({
      sampleRate,
      channels,
      frameDurationMs,
    })

    initialized = true
  }

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

      if (!initialized) {
        ensureInitialized(channels, sampleRate).catch((err) => {
          console.error("Failed to initialize Opus encoder:", err)
        })
        pcmBuffer.push(...planar.map((ch) => ch.slice()))
        pcmBufferSamples += frameLength
        return null
      }

      if (!encoder || !muxer) return null

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
      if (!encoder || !muxer || !headersSent) return null

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
      if (encoder) {
        encoder.free()
        encoder = null
      }
      muxer = null
      pcmBuffer = []
      pcmBufferSamples = 0
      initialized = false
      headersSent = false
    },
  }
}

export const opusOggChunkedEncoderDefinition: ChunkedEncoderDefinition<OpusChunkedEncoderOptions> =
  {
    format: "opus-ogg",
    create: createOpusOggChunkedEncoder,
  }

export const opusWebmChunkedEncoderDefinition: ChunkedEncoderDefinition<OpusChunkedEncoderOptions> =
  {
    format: "opus-webm",
    create: createOpusWebmChunkedEncoder,
  }
