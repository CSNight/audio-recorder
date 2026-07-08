import type { PcmBufferSnapshot } from "../../buffer/types"
import type { ExportEncoderDefinition } from "../../types"
import { resample } from "@media-studio/audio-recorder"
import {
  createAmrEncoder,
  getAmrMimeType,
  getAmrStreamHeader,
  preloadAmrModules,
} from "./amr-wasm-api"
import {
  isSupportSampleRate,
  resolveExportBandMode,
  resolveExportSampleRate,
} from "./sample-rate"
import type { AmrExportOptions, AmrExportResult } from "./types"

export function exportAmrSnapshot(
  snapshot: PcmBufferSnapshot,
  options: AmrExportOptions = {}
): AmrExportResult {
  const targetSampleRate = resolveExportSampleRate(
    options.sampleRate,
    snapshot.sampleRate,
    options.bandMode
  )
  const normalized =
    targetSampleRate === snapshot.sampleRate
      ? snapshot
      : resample(snapshot, targetSampleRate, { isHQ: !!options.isHQ })
  const bandMode = resolveExportBandMode(options.bandMode, targetSampleRate)

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

export const amrExportEncoder: ExportEncoderDefinition<
  "amr",
  AmrExportOptions,
  AmrExportResult
> = {
  type: "amr",
  isSupportSampleRate,
  preload: preloadAmrModules,
  export: (snapshot, options) => exportAmrSnapshot(snapshot, options),
}
