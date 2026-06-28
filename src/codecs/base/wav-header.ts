import type { AudioChannelCount } from "@/types"

const WAV_HEADER_BYTES = 44

/**
 * 生成标准 44 字节 WAV 文件头（PCM / RIFF 格式）。
 * 布局：RIFF→WAVE→fmt（16字节 PCM）→data，全部小端序。
 */
export function createWavHeader(options: {
  dataBytes: number
  sampleRate: number
  channels: AudioChannelCount
  bitRate: 8 | 16
}): ArrayBuffer {
  const { dataBytes, sampleRate, channels, bitRate } = options
  const blockAlign = channels * (bitRate / 8)
  const byteRate = sampleRate * blockAlign
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES)
  const view = new DataView(buffer)

  writeAscii(view, 0, "RIFF")
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, "WAVE")
  writeAscii(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitRate, true)
  writeAscii(view, 36, "data")
  view.setUint32(40, dataBytes, true)

  return buffer
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}
