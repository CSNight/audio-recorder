/**
 * MP3 整段快照导出器。
 *
 * 与 pcm-exporter.ts / wav-exporter.ts 同构：
 * 接收完整 PcmBufferSnapshot，一次性编码为 Uint8Array 形式的 MP3 数据。
 *
 * 与实时流式导出路径不同，此路径不经过 Worker，snapshot 已驻留
 * 在调用线程内存中，直接同步编码即可。
 */
import type { PcmBufferSnapshot } from "../../buffer/types"
import type { ExportEncoderDefinition } from "../../types"
import { resample } from "@media-studio/audio-recorder"
import {
  createMp3Encoder,
  preloadMp3Module,
  resolveMp3EncoderOptions,
} from "./mp3-wasm-api"
import { isSupportSampleRate, resolveExportSampleRate } from "./sample-rate"
import type { Mp3ExportOptions, Mp3ExportResult } from "./types"

const MPEG_FRAME_SIZE = 1152

function downmixToMono(planar: Int16Array[], channels: number): Int16Array {
  const frameLength = planar[0]?.length ?? 0
  const mono = new Int16Array(frameLength)

  for (let i = 0; i < frameLength; i++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) {
      sum += planar[channel]?.[i] ?? 0
    }
    mono[i] = Math.round(sum / Math.max(1, channels))
  }

  return mono
}

function createChannelNormalizedSnapshot(
  snapshot: PcmBufferSnapshot,
  desiredChannels: 1 | 2
): PcmBufferSnapshot & { channels: 1 | 2 } {
  const planar =
    desiredChannels === 1
      ? [
          snapshot.channels <= 1
            ? (snapshot.planar[0] ?? new Int16Array(0))
            : downmixToMono(snapshot.planar, snapshot.channels),
        ]
      : [
          snapshot.planar[0] ?? new Int16Array(0),
          snapshot.channels > 1
            ? (snapshot.planar[1] ?? snapshot.planar[0] ?? new Int16Array(0))
            : (snapshot.planar[0] ?? new Int16Array(0)),
        ]

  return {
    sampleRate: snapshot.sampleRate,
    channels: desiredChannels,
    frameCount: snapshot.frameCount,
    durationMs: snapshot.durationMs,
    planar,
  }
}

export function exportMp3Snapshot(
  snapshot: PcmBufferSnapshot,
  options: Mp3ExportOptions = {}
): Mp3ExportResult {
  const targetSampleRate = resolveExportSampleRate(
    options.sampleRate,
    snapshot.sampleRate
  )
  const desiredChannels: 1 | 2 =
    options.channelMode === "mono" ? 1 : snapshot.channels > 1 ? 2 : 1
  const channelNormalizedSnapshot = createChannelNormalizedSnapshot(
    snapshot,
    desiredChannels
  )
  const normalized =
    targetSampleRate === snapshot.sampleRate
      ? channelNormalizedSnapshot
      : resample(channelNormalizedSnapshot, targetSampleRate, {
          isHQ: !!options.isHQ,
        })
  const encoderOptions = resolveMp3EncoderOptions(
    { ...options, sampleRate: targetSampleRate },
    targetSampleRate,
    desiredChannels
  )
  const left = normalized.planar[0] ?? new Int16Array(0)
  const right =
    encoderOptions.channelMode === "mono"
      ? left
      : (normalized.planar[1] ?? left)
  const encoder = createMp3Encoder(encoderOptions, desiredChannels)
  const chunks: Uint8Array[] = []

  for (let offset = 0; offset < left.length; offset += MPEG_FRAME_SIZE) {
    const frameLeft = left.subarray(offset, offset + MPEG_FRAME_SIZE)
    const frameRight = right.subarray(offset, offset + MPEG_FRAME_SIZE)
    const encoded = encoder.encode(frameLeft, frameRight, frameLeft.length)
    if (encoded.length > 0) {
      chunks.push(encoded)
    }
  }

  const flushed = encoder.flush()
  if (flushed.length > 0) {
    chunks.push(flushed)
  }
  encoder.free()

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const data = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }

  return {
    sampleRate: encoderOptions.sampleRate,
    channels: desiredChannels,
    bitrateKbps: encoderOptions.bitrateKbps,
    durationMs: normalized.durationMs,
    data,
  }
}

export const mp3ExportEncoder: ExportEncoderDefinition<
  "mp3",
  Mp3ExportOptions,
  Mp3ExportResult
> = {
  type: "mp3",
  isSupportSampleRate,
  preload: preloadMp3Module,
  export: (snapshot, options) => exportMp3Snapshot(snapshot, options),
}
