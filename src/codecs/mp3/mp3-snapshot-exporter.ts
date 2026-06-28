/**
 * MP3 整段快照导出器。
 *
 * 与 pcm-exporter.ts / wav-exporter.ts 同构：
 * 接收完整 PcmBufferSnapshot，一次性编码为 Uint8Array 形式的 MP3 数据。
 *
 * 与流式分片编码器（mp3-chunked-encoder.ts）不同，此路径不经过 Worker，snapshot 已驻留
 * 在调用线程内存中，直接同步编码即可。
 */
import type { PcmBufferSnapshot } from "@/buffer/types"
import type { SnapshotEncoderDefinition } from "@/types"
import { resample } from "audio-recorder"
import {
  createMp3Encoder,
  preloadMp3Module,
  resolveMp3EncoderOptions,
} from "./mp3-wasm-api"
import type {
  Mp3ExportOptions,
  Mp3ExportResult,
  ResolvedMp3EncoderOptions,
} from "./types"

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

function normalizeSnapshot(
  snapshot: PcmBufferSnapshot,
  options: Mp3ExportOptions
): {
  left: Int16Array
  right: Int16Array
  channels: 1 | 2
  sampleRate: ResolvedMp3EncoderOptions["sampleRate"]
  durationMs: number
  encoderOptions: ResolvedMp3EncoderOptions
} {
  const desiredChannels =
    options.channelMode === "mono" ? 1 : snapshot.channels > 1 ? 2 : 1
  const encoderOptions = resolveMp3EncoderOptions(
    options,
    options.sampleRate ?? snapshot.sampleRate,
    desiredChannels
  )

  const planar =
    encoderOptions.channelMode === "mono"
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

  const normalized =
    encoderOptions.sampleRate === snapshot.sampleRate
      ? {
          sampleRate: snapshot.sampleRate,
          channels: encoderOptions.channelMode === "mono" ? 1 : 2,
          durationMs: snapshot.durationMs,
          planar,
        }
      : resample(
          {
            sampleRate: snapshot.sampleRate,
            channels: encoderOptions.channelMode === "mono" ? 1 : 2,
            frameCount: snapshot.frameCount,
            durationMs: snapshot.durationMs,
            planar,
          },
          encoderOptions.sampleRate,
          {}
        )

  const left = normalized.planar[0] ?? new Int16Array(0)
  const right =
    encoderOptions.channelMode === "mono"
      ? left
      : (normalized.planar[1] ?? left)

  return {
    left,
    right,
    channels: encoderOptions.channelMode === "mono" ? 1 : 2,
    sampleRate: encoderOptions.sampleRate,
    durationMs: normalized.durationMs,
    encoderOptions,
  }
}

export function exportMp3Snapshot(
  snapshot: PcmBufferSnapshot,
  options: Mp3ExportOptions = {}
): Mp3ExportResult {
  const normalized = normalizeSnapshot(snapshot, options)
  const encoder = createMp3Encoder(
    normalized.encoderOptions,
    normalized.channels
  )
  const chunks: Uint8Array[] = []

  for (
    let offset = 0;
    offset < normalized.left.length;
    offset += MPEG_FRAME_SIZE
  ) {
    const left = normalized.left.subarray(offset, offset + MPEG_FRAME_SIZE)
    const right = normalized.right.subarray(offset, offset + MPEG_FRAME_SIZE)
    const encoded = encoder.encode(left, right, left.length)
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
    sampleRate: normalized.sampleRate,
    channels: normalized.channels,
    bitrateKbps: normalized.encoderOptions.bitrateKbps,
    durationMs: normalized.durationMs,
    data,
  }
}

export const mp3SnapshotEncoderDefinition: SnapshotEncoderDefinition<
  "mp3",
  Mp3ExportOptions,
  Mp3ExportResult
> = {
  type: "mp3",
  preload: preloadMp3Module,
  export: (snapshot, options) => exportMp3Snapshot(snapshot, options),
}
