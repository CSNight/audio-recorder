import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"

/**
 * 按 seq 排序的乱序重排缓冲。
 * 超过 timeoutMs 未收到期望 seq 时，强制放行已有包。
 */
export class ReorderBuffer {
  onRelease: ((packet: StreamingPacketPayload) => void) | null = null
  private buffer: StreamingPacketPayload[] = []
  private nextSeq = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

  constructor(private readonly timeoutMs = 200) {}

  push(packet: StreamingPacketPayload): void {
    if (!this.initialized) {
      this.nextSeq = packet.seq
      this.initialized = true
    }
    this.buffer.push(packet)
    this.buffer.sort((a, b) => a.seq - b.seq)
    this.scheduleTimeout()
  }

  drain(): void {
    while (this.buffer.length > 0 && this.buffer[0]!.seq === this.nextSeq) {
      const packet = this.buffer.shift()!
      this.nextSeq = packet.seq + 1
      this.onRelease?.(packet)
    }
  }

  reset(): void {
    this.buffer = []
    this.nextSeq = 0
    this.initialized = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private flushForced(): void {
    while (this.buffer.length > 0) {
      const packet = this.buffer.shift()!
      this.nextSeq = packet.seq + 1
      this.onRelease?.(packet)
    }
  }

  private scheduleTimeout(): void {
    // 已有 timer 则不重置——避免持续 push 导致超时永远被推迟
    if (this.timer !== null) return
    if (this.buffer.length === 0) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flushForced()
    }, this.timeoutMs)
  }
}
