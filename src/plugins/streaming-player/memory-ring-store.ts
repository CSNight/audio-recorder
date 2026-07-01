import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"

/**
 * 固定容量的环形 packet 存储，用于 replay。
 * 纯 JS 对象数组实现，无需 SharedArrayBuffer。
 */
export class MemoryRingStore {
  private readonly buffer: (StreamingPacketPayload | undefined)[]
  private head = 0
  private count = 0

  constructor(private readonly capacity: number) {
    this.buffer = new Array(capacity)
  }

  push(packet: StreamingPacketPayload): void {
    this.buffer[this.head] = packet
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /**
   * 取最近 durationMs 毫秒内的 packet，按时序（旧→新）返回。
   */
  recent(durationMs: number): StreamingPacketPayload[] {
    const result: StreamingPacketPayload[] = []
    let totalMs = 0
    for (let i = 1; i <= this.count; i++) {
      const idx = (this.head - i + this.capacity) % this.capacity
      const packet = this.buffer[idx]
      if (!packet) break
      totalMs += packet.durationMs ?? 0
      result.unshift(packet)
      if (totalMs >= durationMs) break
    }
    return result
  }

  clear(): void {
    this.head = 0
    this.count = 0
    this.buffer.fill(undefined)
  }
}
