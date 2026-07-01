import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"

/**
 * JitterBuffer：攒够 targetLatencyMs 后开始出队。
 * 外部调用 drain() 触发出队，packet 通过 onRelease 回调交付。
 */
export class JitterBuffer {
  onRelease: ((packet: StreamingPacketPayload) => void) | null = null

  private queue: StreamingPacketPayload[] = []
  private bufferedMs = 0
  private started = false

  constructor(private readonly targetLatencyMs: number = 300) {}

  push(packet: StreamingPacketPayload): void {
    this.queue.push(packet)
    this.bufferedMs += packet.durationMs
  }

  /**
   * 每次 tick 最多释放 releaseWindowMs 毫秒的 packet。
   * 默认 releaseWindowMs = 60ms（覆盖 3 个 20ms tick 的余量），
   * 避免一次性投出大量 packet 导致并发 decode 使 scheduleTime 追不上 currentTime。
   */
  drain(releaseWindowMs = 60): void {
    if (!this.started) {
      if (this.bufferedMs < this.targetLatencyMs) return
      this.started = true
    }
    let releasedMs = 0
    while (this.queue.length > 0 && releasedMs < releaseWindowMs) {
      const packet = this.queue.shift()!
      this.bufferedMs = Math.max(0, this.bufferedMs - packet.durationMs)
      releasedMs += packet.durationMs
      this.onRelease?.(packet)
    }
    if (this.queue.length === 0) {
      this.started = false
    }
  }

  getBufferedMs(): number {
    return this.bufferedMs
  }

  dropOld(targetMs: number): number {
    let dropped = 0
    let droppedMs = 0
    while (this.queue.length > 0 && droppedMs < targetMs) {
      const p = this.queue.shift()!
      droppedMs += p.durationMs
      this.bufferedMs = Math.max(0, this.bufferedMs - p.durationMs)
      dropped++
    }
    return dropped
  }

  reset(): void {
    this.queue = []
    this.bufferedMs = 0
    this.started = false
  }
}
