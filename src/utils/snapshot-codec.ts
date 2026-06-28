import type { PcmBufferSnapshot } from "@/buffer/types"

const SNAPSHOT_VERSION = 1

/**
 * 将 PCM 快照序列化为二进制 ArrayBuffer，便于持久化存储或跨线程传输。
 *
 * 二进制布局：
 * - 4 字节 版本号（uint32）
 * - 4 字节 采样率（uint32）
 * - 1 字节 声道数（uint8）
 * - 4 字节 帧数（uint32）
 * - 8 字节 时长 ms（float64）
 * - 每声道 4 字节长度（uint32）
 * - 各声道 PCM 数据（Int16Array 原始字节）
 */
export function serializePcmSnapshot(snapshot: PcmBufferSnapshot): ArrayBuffer {
  const channelLengths = snapshot.planar.map((channel) => channel.length)
  const headerBytes = 4 + 4 + 1 + 4 + 8 + snapshot.channels * 4
  const payloadBytes = channelLengths.reduce(
    (total, length) => total + length * Int16Array.BYTES_PER_ELEMENT,
    0
  )
  const buffer = new ArrayBuffer(headerBytes + payloadBytes)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  let offset = 0

  view.setUint32(offset, SNAPSHOT_VERSION, true)
  offset += 4
  view.setUint32(offset, snapshot.sampleRate, true)
  offset += 4
  view.setUint8(offset, snapshot.channels)
  offset += 1
  view.setUint32(offset, snapshot.frameCount, true)
  offset += 4
  view.setFloat64(offset, snapshot.durationMs, true)
  offset += 8

  for (const length of channelLengths) {
    view.setUint32(offset, length, true)
    offset += 4
  }

  for (const channel of snapshot.planar) {
    bytes.set(
      new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength),
      offset
    )
    offset += channel.byteLength
  }

  return buffer
}

export function deserializePcmSnapshot(buffer: ArrayBuffer): PcmBufferSnapshot {
  const view = new DataView(buffer)
  let offset = 0
  const version = view.getUint32(offset, true)
  offset += 4

  if (version !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported PCM snapshot version ${version}.`)
  }

  const sampleRate = view.getUint32(offset, true)
  offset += 4
  const channels = normalizeChannels(view.getUint8(offset))
  offset += 1
  const frameCount = view.getUint32(offset, true)
  offset += 4
  const durationMs = view.getFloat64(offset, true)
  offset += 8
  const channelLengths = Array.from({ length: channels }, () => {
    const length = view.getUint32(offset, true)
    offset += 4
    return length
  })
  const planar = channelLengths.map((length) => {
    const end = offset + length * Int16Array.BYTES_PER_ELEMENT
    const channel = new Int16Array(buffer.slice(offset, end))
    offset = end
    return channel
  })

  return {
    sampleRate,
    channels,
    frameCount,
    durationMs,
    planar,
  }
}

function normalizeChannels(value: number): 1 | 2 {
  if (value === 1 || value === 2) {
    return value
  }

  throw new Error(`Unsupported PCM snapshot channel count ${value}.`)
}
