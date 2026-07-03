import type { PcmBufferSnapshot } from "../../buffer/types"
import type { PcmExportOptions, PcmExportResult } from "./pcm-types"
import { resample } from "@csnight/audio-recorder"
import { resolveExportSampleRate } from "./sample-rate"

type PcmLikeSnapshot = Pick<
  PcmBufferSnapshot,
  "sampleRate" | "channels" | "durationMs" | "planar"
>

function normalizeBitRate(bitRate: PcmExportOptions["bitRate"]): 8 | 16 {
  if (bitRate === undefined) {
    return 16
  }
  if (bitRate !== 8 && bitRate !== 16) {
    throw new Error(`PCM export bitRate ${bitRate} is not supported.`)
  }

  return bitRate
}

/** 将 PCM 快照导出为交织（interleaved）字节流，支持重采样与位深转换 */
export function exportPcmSnapshot(
  snapshot: PcmBufferSnapshot,
  options: PcmExportOptions = {}
): PcmExportResult {
  const targetSampleRate = resolveExportSampleRate(
    options.sampleRate,
    snapshot.sampleRate
  )
  const normalized =
    targetSampleRate === snapshot.sampleRate
      ? snapshot
      : resample(snapshot, targetSampleRate, { isHQ: !!options.isHQ })

  return createPcmExportResult(normalized, options.bitRate)
}

export function createPcmExportResult(
  snapshot: PcmLikeSnapshot,
  bitRateOption: PcmExportOptions["bitRate"]
): PcmExportResult {
  const bitRate = normalizeBitRate(bitRateOption)
  const interleaved = interleaveChannels(snapshot.planar, snapshot.channels)

  return {
    sampleRate: snapshot.sampleRate,
    channels: snapshot.channels,
    bitRate,
    durationMs: snapshot.durationMs,
    data: bitRate === 16 ? interleaved : convertInt16ToInt8(interleaved),
  }
}

function interleaveChannels(
  planar: readonly Int16Array[],
  channels: number
): Int16Array {
  const frameLength = planar[0]?.length ?? 0

  // Mono: 直接拷贝
  if (channels === 1) {
    const ch0 = planar[0]
    return ch0 ? new Int16Array(ch0) : new Int16Array(frameLength)
  }

  // Stereo: 第二声道缺失时复用第一声道（单声道升混）
  if (channels === 2) {
    const interleaved = new Int16Array(frameLength * 2)
    const left = planar[0]
    const right = planar[1] ?? left
    for (let i = 0; i < frameLength; i += 1) {
      interleaved[i * 2] = left ? left[i]! : 0
      interleaved[i * 2 + 1] = right ? right[i]! : 0
    }
    return interleaved
  }

  // 多声道：通用交织逻辑（3+声道，缺失声道补0）
  const interleaved = new Int16Array(frameLength * channels)
  for (let i = 0; i < frameLength; i += 1) {
    for (let ch = 0; ch < channels; ch += 1) {
      interleaved[i * channels + ch] = planar[ch] ? planar[ch]![i]! : 0
    }
  }

  return interleaved
}

function convertInt16ToInt8(source: Int16Array): Int8Array {
  const output = new Int8Array(source.length)

  for (let index = 0; index < source.length; index += 1) {
    const sample = source[index] ?? 0
    // arithmetic right-shift avoids Math.round truncation at +32767
    // (32767 >> 8 === 127, whereas Math.round(32767/256) would also be 128 clamped to 127,
    //  but >> 8 is both faster and semantically correct for PCM bit-depth reduction).
    output[index] = sample >> 8
  }

  return output
}
