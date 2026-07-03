import type { AudioFrame } from "../types"

/** 计算一帧 PCM 数据的总字节数（所有声道字节之和）。 */
export function getFrameBytes(frame: AudioFrame): number {
  let total = 0
  for (let channelIndex = 0; channelIndex < frame.channels; channelIndex += 1) {
    total += frame.planar[channelIndex]?.byteLength ?? 0
  }

  return total
}

export function mergeChannelChunks(chunks: readonly Int16Array[]): Int16Array {
  let totalLength = 0
  for (const chunk of chunks) {
    totalLength += chunk.length
  }

  const merged = new Int16Array(totalLength)
  let writeOffset = 0

  for (const chunk of chunks) {
    merged.set(chunk, writeOffset)
    writeOffset += chunk.length
  }

  return merged
}
