import type { PcmBufferSnapshot } from "../../buffer/types"
import type { ExportEncoderDefinition } from "../../types"
import { resample } from "@csnight/audio-recorder"
import {
  createAc3Encoder,
  preloadAc3Module,
  resolveAc3EncoderOptions,
} from "./ac3-wasm-api"
import {
  isSupportSampleRate as isAc3SupportSampleRate,
  resolveExportSampleRate,
} from "./sample-rate"
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

function mimeTypeForCodec(codec: ResolvedAc3EncoderOptions["codec"]): string {
  return codec === "ac3" ? "audio/ac3" : "audio/eac3"
}

export function exportAc3Snapshot(
  snapshot: PcmBufferSnapshot,
  options: Ac3ExportOptions = {}
): Ac3ExportResult {
  const codec = options.codec ?? "ac3"
  const targetSampleRate = resolveExportSampleRate(
    options.sampleRate,
    snapshot.sampleRate,
    codec
  )
  const normalized =
    targetSampleRate === snapshot.sampleRate
      ? snapshot
      : resample(snapshot, targetSampleRate, { isHQ: !!options.isHQ })
  const encoderOptions = resolveAc3EncoderOptions(
    {
      ...options,
      codec,
      sampleRate: targetSampleRate,
    },
    targetSampleRate,
    normalized.channels
  )
  const encoder = createAc3Encoder(encoderOptions)
  const chunks: Uint8Array[] = []
  const totalSamples = normalized.planar[0]?.length ?? 0

  try {
    for (let offset = 0; offset < totalSamples; offset += encoder.frameSize) {
      const chunkPlanar = normalized.planar.map((channel) => {
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
    mimeType: mimeTypeForCodec(encoderOptions.codec),
    codec: encoderOptions.codec,
    sampleRate: encoderOptions.sampleRate,
    channels: normalized.channels,
    bitrate: encoderOptions.bitrate,
  }
}

export const ac3ExportEncoder: ExportEncoderDefinition<
  "ac3",
  FixedCodecExportOptions,
  Ac3ExportResult
> = {
  type: "ac3",
  isSupportSampleRate: (sampleRate) => isAc3SupportSampleRate(sampleRate, "ac3"),
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
  isSupportSampleRate: (sampleRate) => isAc3SupportSampleRate(sampleRate, "eac3"),
  preload: preloadAc3Module,
  export: (snapshot, options) =>
    exportAc3Snapshot(snapshot, { ...options, codec: "eac3" }),
}
