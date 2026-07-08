import type { PcmBufferSnapshot } from "../../buffer/types"
import { resample } from "@media-studio/audio-recorder"
import { createPcmExportResult } from "./pcm-exporter"
import { resolveExportSampleRate } from "./sample-rate"
import type { WavExportOptions, WavExportResult } from "./wav-types"
import { createWavHeader } from "./wav-header"

const WAV_MIME_TYPE = "audio/wav"

/** 导出标准 WAV 文件：先复用 PCM 导出得到裸采样数据，再拼接 44 字节标准 WAV 头 */
export function exportWavSnapshot(
  snapshot: PcmBufferSnapshot,
  options: WavExportOptions = {}
): WavExportResult {
  const targetSampleRate = resolveExportSampleRate(
    options.sampleRate,
    snapshot.sampleRate
  )
  const normalized =
    targetSampleRate === snapshot.sampleRate
      ? snapshot
      : resample(snapshot, targetSampleRate, { isHQ: !!options.isHQ })
  const pcm = createPcmExportResult(normalized, options.bitRate)
  const wavPayload = createWavPcmPayload(pcm.data, pcm.bitRate)
  const header = createWavHeader({
    dataBytes: wavPayload.byteLength,
    sampleRate: pcm.sampleRate,
    channels: pcm.channels,
    bitRate: pcm.bitRate,
  })
  const data = new Uint8Array(header.byteLength + wavPayload.byteLength)

  data.set(new Uint8Array(header), 0)
  data.set(wavPayload, header.byteLength)

  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels,
    bitRate: pcm.bitRate,
    durationMs: pcm.durationMs,
    mimeType: WAV_MIME_TYPE,
    data,
  }
}

/**
 * 将 PCM 导出结果的字节流转换为 WAV payload 字节序列。
 * 8-bit PCM 在 WAV 规范中必须存为无符号字节（0..255），
 * 而 PcmExportResult.data 的 8-bit 样本为有符号值（-128..127），
 * 因此需要加 128 做偏移；16-bit 直接复用原始字节序列。
 */
function createWavPcmPayload(source: Uint8Array, bitRate: 8 | 16): Uint8Array {
  if (bitRate === 8) {
    // 8-bit WAV：有符号 → 无符号偏移（+128）
    const bytes = new Uint8Array(source.length)

    for (let index = 0; index < source.length; index += 1) {
      // source 中的 8-bit 样本以有符号方式存储在 Uint8Array 内
      // （即值域实为 -128..127，用无符号表示为 0..127 和 128..255）
      // 加 128 并取低 8 位完成偏移
      bytes[index] = ((source[index] ?? 0) + 128) & 0xff
    }

    return bytes
  }

  // 16-bit：字节序已是小端 Int16，直接复用，不拷贝
  return source
}
