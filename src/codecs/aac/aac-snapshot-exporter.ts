import type { PcmBufferSnapshot } from "@/buffer/types"
import type { SnapshotEncoderDefinition } from "@/types"
import { resample } from "audio-recorder"
import { createAacEncoder, preloadAacModule } from "./aac-wasm-api"
import type { AacExportOptions, AacExportResult } from "./types"

function interleave(planar: Int16Array[], channels: number, frameSize: number) {
  const interleaved = new Int16Array(frameSize * channels)

  for (let i = 0; i < frameSize; i++) {
    for (let channel = 0; channel < channels; channel++) {
      interleaved[i * channels + channel] = planar[channel]?.[i] ?? 0
    }
  }

  return interleaved
}

function wrapPacket(packet: Uint8Array, audioSpecificConfig: Uint8Array) {
  const audioObjectType = (audioSpecificConfig[0]! >> 3) & 0x1f
  const samplingFrequencyIndex =
    ((audioSpecificConfig[0]! & 0x07) << 1) | (audioSpecificConfig[1]! >> 7)
  const channelConfiguration = (audioSpecificConfig[1]! >> 3) & 0x0f
  const profile = Math.max(0, Math.min(3, audioObjectType - 1))
  const frameLength = packet.byteLength + 7

  const header = new Uint8Array(7)
  header[0] = 0xff
  header[1] = 0xf1
  header[2] =
    (profile << 6) |
    ((samplingFrequencyIndex & 0x0f) << 2) |
    ((channelConfiguration >> 2) & 0x01)
  header[3] =
    ((channelConfiguration & 0x03) << 6) | ((frameLength >> 11) & 0x03)
  header[4] = (frameLength >> 3) & 0xff
  header[5] = ((frameLength & 0x07) << 5) | 0x1f
  header[6] = 0xfc

  const frame = new Uint8Array(frameLength)
  frame.set(header)
  frame.set(packet, 7)
  return frame
}

export function exportAacSnapshot(
  snapshot: PcmBufferSnapshot,
  options: AacExportOptions = {}
): AacExportResult {
  const targetSampleRate = options.sampleRate ?? snapshot.sampleRate
  const normalized =
    targetSampleRate === snapshot.sampleRate
      ? snapshot
      : resample(snapshot, targetSampleRate, {})

  const encoder = createAacEncoder({
    sampleRate: normalized.sampleRate,
    channels: normalized.channels,
    bitrate: options.bitrate ?? 128_000,
  })

  const chunks: Uint8Array[] = []
  const totalSamples = normalized.planar[0]?.length ?? 0

  for (let offset = 0; offset < totalSamples; offset += encoder.frameSize) {
    const chunkPlanar = normalized.planar.map((channel: Uint8Array) => {
      const slice = channel.subarray(offset, offset + encoder.frameSize)
      if (slice.length === encoder.frameSize) {
        return slice
      }

      const padded = new Int16Array(encoder.frameSize)
      padded.set(slice)
      return padded
    })

    const interleaved = interleave(
      chunkPlanar,
      normalized.channels,
      encoder.frameSize
    )

    for (const packet of encoder.encode(interleaved)) {
      chunks.push(wrapPacket(packet, encoder.audioSpecificConfig))
    }
  }

  for (const packet of encoder.flush()) {
    chunks.push(wrapPacket(packet, encoder.audioSpecificConfig))
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
    data,
    mimeType: "audio/aac",
    sampleRate: normalized.sampleRate,
    channels: normalized.channels,
    bitrate: encoder.bitrate,
  }
}

export const aacSnapshotEncoderDefinition: SnapshotEncoderDefinition<
  "aac",
  AacExportOptions,
  AacExportResult
> = {
  type: "aac",
  preload: preloadAacModule,
  export: (snapshot, options) => exportAacSnapshot(snapshot, options),
}
