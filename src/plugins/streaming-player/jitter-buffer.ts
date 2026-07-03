import type { StreamingPacketPayload } from "../streaming-export"

/**
 * JitterBuffer：累积至 targetLatencyMs 后开始出队。
 * 外部调用 drain() 触发出队，packet 通过 onRelease 回调交付。
 */
export class JitterBuffer {
  onRelease: ((packet: StreamingPacketPayload) => void) | null = null

  private queue: StreamingPacketPayload[] = []
  private _bufferedMs = 0
  private started = false

  constructor(private readonly targetLatencyMs: number = 300) {}

  push(packet: StreamingPacketPayload): void {
    this.queue.push(packet)
    this._bufferedMs += packet.durationMs
  }

  /**
   * 每次 tick 最多释放 releaseWindowMs 毫秒的 packet。
   * 若尚未 started，则先等累计达到 targetLatencyMs 再开始出队。
   */
  drain(releaseWindowMs = 60): void {
    if (!this.started) {
      if (this._bufferedMs < this.targetLatencyMs) return
      this.started = true
    }
    let releasedMs = 0
    while (this.queue.length > 0 && releasedMs < releaseWindowMs) {
      const packet = this.queue.shift()!
      this._bufferedMs = Math.max(0, this._bufferedMs - packet.durationMs)
      releasedMs += packet.durationMs
      this.onRelease?.(packet)
    }
    if (this.queue.length === 0) {
      this.started = false
    }
  }

  getBufferedMs(): number {
    return this._bufferedMs
  }

  /**
   * 丢弃最旧的包，直到累计丢弃时长 >= targetMs 或队列为空。
   * 返回实际丢弃的包数。
   */
  dropOld(targetMs: number): number {
    let dropped = 0
    let droppedMs = 0
    while (this.queue.length > 0 && droppedMs < targetMs) {
      const p = this.queue.shift()!
      droppedMs += p.durationMs
      this._bufferedMs = Math.max(0, this._bufferedMs - p.durationMs)
      dropped++
    }
    return dropped
  }

  reset(): void {
    this.queue = []
    this._bufferedMs = 0
    this.started = false
  }
}
