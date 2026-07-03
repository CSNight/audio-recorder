import type { PcmBufferSnapshot } from "../../buffer/types"
import type { ExportEncoderDefinition } from "../../types"
import { resample } from "@csnight/audio-recorder"
import {
  createAc3Encoder,
  preloadAc3Module,
  resolveAc3EncoderOptions,
} from "./ac3-wasm-api"
import type {
  Ac3ExportOptions,
  Ac3ExportResult,
  ResolvedAc3EncoderOptions,
} from "./types"

type FixedCodecExportOptions = Omit<Ac3ExportOptions, "codec">

function interleave(planar: Int16Array[], channels: number, frameSize: number) {
  const interleaved = new Int16Array(frameSize * channels)

  for (let i = 0; i < frameSize; i++) {
    for (let channel = 0; channel < channels; channel++) {
      interleaved[i * channels + channel] = planar[channel]?.[i] ?? 0
    }
  }

  return interleaved
}

function normalizeSnapshot(
  snapshot: PcmBufferSnapshot,
  options: Ac3ExportOptions
): {
  snapshot: {
    sampleRate: number
    channels: number
    durationMs: number
    planar: Int16Array[]
  }
  encoderOptions: ResolvedAc3EncoderOptions
} {
  const encoderOptions = resolveAc3EncoderOptions(
    options,
    options.sampleRate ?? snapshot.sampleRate,
    snapshot.channels
  )

  const normalized =
    encoderOptions.sampleRate === snapshot.sampleRate
      ? snapshot
      : resample(snapshot, encoderOptions.sampleRate, {})

  return {
    snapshot: normalized,
    encoderOptions,
  }
}

function mimeTypeForCodec(codec: ResolvedAc3EncoderOptions["codec"]): string {
  return codec === "ac3" ? "audio/ac3" : "audio/eac3"
}

export function exportAc3Snapshot(
  snapshot: PcmBufferSnapshot,
  options: Ac3ExportOptions = {}
): Ac3ExportResult {
  const normalized = normalizeSnapshot(snapshot, options)
  const encoder = createAc3Encoder(normalized.encoderOptions)
  const chunks: Uint8Array[] = []
  const totalSamples = normalized.snapshot.planar[0]?.length ?? 0

  try {
    for (
      let offset = 0;
      offset < totalSamples;
      offset += encoder.frameSize
    ) {
      const chunkPlanar = normalized.snapshot.planar.map((channel) => {
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
        normalized.snapshot.channels,
        encoder.frameSize
      )

      for (const packet of encoder.encode(interleaved)) {
        if (packet.length > 0) {
          chunks.push(packet)
        }
      }
    }

    for (const packet of encoder.flush()) {
      if (packet.length > 0) {
        chunks.push(packet)
      }
    }
  } finally {
    encoder.free()
  }

  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const data = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }

  return {
    data,
    mimeType: mimeTypeForCodec(normalized.encoderOptions.codec),
    codec: normalized.encoderOptions.codec,
    sampleRate: normalized.encoderOptions.sampleRate,
    channels: normalized.snapshot.channels,
    bitrate: normalized.encoderOptions.bitrate,
  }
}

export const ac3ExportEncoder: ExportEncoderDefinition<
  "ac3",
  FixedCodecExportOptions,
  Ac3ExportResult
> = {
  type: "ac3",
  preload: preloadAc3Module,
  export: (snapshot, options) =>
    exportAc3Snapshot(snapshot, { ...options, codec: "ac3" }),
}

export const eac3ExportEncoder: ExportEncoderDefinition<
  "eac3",
  FixedCodecExportOptions,
  Ac3ExportResult
> = {
  type: "eac3",
  preload: preloadAc3Module,
  export: (snapshot, options) =>
    exportAc3Snapshot(snapshot, { ...options, codec: "eac3" }),
}
