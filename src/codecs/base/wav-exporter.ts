import type { PcmBufferSnapshot } from "../../buffer/types"
import { exportPcmSnapshot } from "./pcm-exporter"
import type { WavExportOptions, WavExportResult } from "./wav-types"
import { createWavHeader } from "./wav-header"

const WAV_MIME_TYPE = "audio/wav"

/** 导出标准 WAV 文件：先复用 PCM 导出得到裸采样数据，再拼接 44 字节标准 WAV 头 */
export function exportWavSnapshot(
  snapshot: PcmBufferSnapshot,
  options: WavExportOptions = {}
): WavExportResult {
  const pcm = exportPcmSnapshot(snapshot, options)
  const bytesPerSample = pcm.bitRate / 8
  const payloadSize = pcm.data.length * bytesPerSample
  const header = createWavHeader({
    dataBytes: payloadSize,
    sampleRate: pcm.sampleRate,
    channels: pcm.channels,
    bitRate: pcm.bitRate,
  })
  const arrayBuffer = new ArrayBuffer(header.byteLength + payloadSize)
  const output = new Uint8Array(arrayBuffer)

  output.set(new Uint8Array(header), 0)
  output.set(createPcmByteView(pcm.data), header.byteLength)

  return {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels,
    bitRate: pcm.bitRate,
    durationMs: pcm.durationMs,
    mimeType: WAV_MIME_TYPE,
    arrayBuffer,
    blob: new Blob([arrayBuffer], { type: WAV_MIME_TYPE }),
  }
}

function createPcmByteView(source: Int8Array | Int16Array): Uint8Array {
  if (source instanceof Int8Array) {
    // 8-bit PCM 在 WAV 中按无符号字节存储，这里做一次偏移转换。
    const bytes = new Uint8Array(source.length)

    for (let index = 0; index < source.length; index += 1) {
      bytes[index] = (source[index] ?? 0) + 128
    }

    return bytes
  }

  return new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
}
