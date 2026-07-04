import type { StreamingPacketPayload } from "../../types"

/**
 * 按 seq 排序的乱序重排缓冲。
 * 超过 timeoutMs 未收到期望 seq 时，强制放行已有包。
 */
export class ReorderBuffer {
  onRelease: ((packet: StreamingPacketPayload) => void) | null = null
  private buffer: StreamingPacketPayload[] = []
  private bufferedMs = 0
  private nextSeq = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private initialized = false

  constructor(private readonly timeoutMs = 200) {}

  push(packet: StreamingPacketPayload): void {
    if (!this.initialized) {
      this.nextSeq = packet.seq
      this.initialized = true
    }
    // 丢弃已过期的迟到包（seq < nextSeq），避免阻塞队列头或把 nextSeq 往回拨
    if (packet.seq < this.nextSeq) return
    // 丢弃重复包（seq 已在缓冲区内），避免同一 seq 被出队两次导致 JitterBuffer 收到重复数据
    if (this.buffer.some((p) => p.seq === packet.seq)) return
    this.buffer.push(packet)
    this.bufferedMs += packet.durationMs
    this.buffer.sort((a, b) => a.seq - b.seq)
    this.scheduleTimeout()
  }

  drain(): void {
    while (this.buffer.length > 0 && this.buffer[0]!.seq === this.nextSeq) {
      const packet = this.buffer.shift()!
      this.bufferedMs = Math.max(0, this.bufferedMs - packet.durationMs)
      this.nextSeq = packet.seq + 1
      this.onRelease?.(packet)
    }
    // 队列已清空时取消 timer，使下次 push 能重新注册超时
    if (this.buffer.length === 0 && this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  getBufferedMs(): number {
    return this.bufferedMs
  }

  /**
   * 丢弃最旧的乱序包，直到累计丢弃时长 >= targetMs 或队列为空。
   * 每丢一个包都会前移 nextSeq，用于 live-edge 追赶当前时刻。
   */
  dropOld(targetMs: number): number {
    let dropped = 0
    let droppedMs = 0
    while (this.buffer.length > 0 && droppedMs < targetMs) {
      const packet = this.buffer.shift()!
      droppedMs += packet.durationMs
      this.bufferedMs = Math.max(0, this.bufferedMs - packet.durationMs)
      this.nextSeq = packet.seq + 1
      dropped++
    }
    if (this.buffer.length === 0 && this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    return dropped
  }

  reset(): void {
    this.buffer = []
    this.bufferedMs = 0
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
      this.bufferedMs = Math.max(0, this.bufferedMs - packet.durationMs)
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
