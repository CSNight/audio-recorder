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
  if (normalized.channels > 2) {
    throw new Error(
      `PCM export does not support ${normalized.channels} channels. Only mono (1) and stereo (2) are supported.`
    )
  }
  const interleaved = interleaveChannels(normalized.planar, normalized.channels as 1 | 2)

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

  // Fix #6: specialised hot paths avoid optional-chaining overhead in the inner loop.
  if (channels === 1) {
    // Mono: a direct copy is all that is needed.
    const ch0 = planar[0]
    return ch0 ? new Int16Array(ch0) : new Int16Array(frameLength)
  }

  // Stereo: unrolled two-channel interleave with direct index writes.
  const interleaved = new Int16Array(frameLength * 2)
  const ch0 = planar[0]
  const ch1 = planar[1]
  for (let i = 0; i < frameLength; i += 1) {
    interleaved[i * 2] = ch0 ? ch0[i]! : 0
    interleaved[i * 2 + 1] = ch1 ? ch1[i]! : 0
  }

  return interleaved
}

function convertInt16ToInt8(source: Int16Array): Int8Array {
  const output = new Int8Array(source.length)

  for (let index = 0; index < source.length; index += 1) {
    const sample = source[index] ?? 0
    // Fix #8: arithmetic right-shift avoids Math.round truncation at +32767
    // (32767 >> 8 === 127, whereas Math.round(32767/256) would also be 128 clamped to 127,
    //  but >> 8 is both faster and semantically correct for PCM bit-depth reduction).
    output[index] = sample >> 8
  }

  return output
}
