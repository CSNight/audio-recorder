import type { PcmBufferSnapshot } from "@/buffer/types"
import type { PcmExportOptions, PcmExportResult } from "@/codecs/pcm/types"
import { resamplePlanarPcm, resamplePlanarPcmHQ } from "@/utils/resample"

function normalizeBitRate(bitRate: PcmExportOptions["bitRate"]): 8 | 16 {
  if (bitRate === undefined) {
    return 16
  }
  if (bitRate !== 8 && bitRate !== 16) {
    throw new Error(`PCM export bitRate ${bitRate} is not supported.`)
  }

  return bitRate
}

export function exportPcmSnapshot(
  snapshot: PcmBufferSnapshot,
  options: PcmExportOptions = {}
): PcmExportResult {
  const targetSampleRate = options.sampleRate ?? snapshot.sampleRate
  const bitRate = normalizeBitRate(options.bitRate)
  const normalized = options.isHQ
    ? resamplePlanarPcmHQ(snapshot, targetSampleRate)
    : resamplePlanarPcm(snapshot, targetSampleRate)
  const interleaved = interleaveChannels(normalized.planar, normalized.channels)

  return {
    sampleRate: normalized.sampleRate,
    channels: normalized.channels,
    bitRate,
    durationMs: normalized.durationMs,
    data: bitRate === 16 ? interleaved : convertInt16ToInt8(interleaved),
  }
}

function interleaveChannels(
  planar: readonly Int16Array[],
  channels: 1 | 2
): Int16Array {
  const frameLength = planar[0]?.length ?? 0
  const interleaved = new Int16Array(frameLength * channels)

  for (let sampleIndex = 0; sampleIndex < frameLength; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      interleaved[sampleIndex * channels + channelIndex] =
        planar[channelIndex]?.[sampleIndex] ?? 0
    }
  }

  return interleaved
}

function convertInt16ToInt8(source: Int16Array): Int8Array {
  const output = new Int8Array(source.length)

  for (let index = 0; index < source.length; index += 1) {
    const sample = source[index] ?? 0
    output[index] = Math.max(-128, Math.min(127, Math.round(sample / 256)))
  }

  return output
}
