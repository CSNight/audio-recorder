import type { PcmBufferSnapshot } from "@/buffer/types"
import type { SnapshotEncoderDefinition } from "@/types"
import { resample } from "audio-recorder"
import {
  createAmrEncoder,
  getAmrMimeType,
  getAmrStreamHeader,
  getAmrTargetSampleRate,
  preloadAmrModules,
} from "./amr-wasm-api"
import type { AmrExportOptions, AmrExportResult } from "./types"

export function exportAmrSnapshot(
  snapshot: PcmBufferSnapshot,
  options: AmrExportOptions = {}
): AmrExportResult {
  const bandMode = options.bandMode ?? "nb"
  const targetSampleRate = getAmrTargetSampleRate(bandMode)
  const normalized =
    snapshot.sampleRate === targetSampleRate
      ? snapshot
      : resample(snapshot, targetSampleRate, {})

  const encoder = createAmrEncoder({ bandMode })
  const mono = normalized.planar[0] ?? new Int16Array(0)
  const chunks: Uint8Array[] = [getAmrStreamHeader(bandMode)]

  for (let offset = 0; offset < mono.length; offset += encoder.frameSize) {
    const slice = mono.subarray(offset, offset + encoder.frameSize)
    const frame =
      slice.length === encoder.frameSize
        ? slice
        : (() => {
            const padded = new Int16Array(encoder.frameSize)
            padded.set(slice)
            return padded
          })()

    chunks.push(encoder.encode(frame))
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
    mimeType: getAmrMimeType(bandMode),
    bandMode,
    sampleRate: targetSampleRate,
    channels: 1,
    durationMs: normalized.durationMs,
  }
}

export const amrSnapshotEncoderDefinition: SnapshotEncoderDefinition<
  "amr",
  AmrExportOptions,
  AmrExportResult
> = {
  type: "amr",
  preload: preloadAmrModules,
  export: (snapshot, options) => exportAmrSnapshot(snapshot, options),
}
