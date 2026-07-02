import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"

/**
 * JitterBuffer：累积至 targetLatencyMs 后开始出队。
 * 若缓冲超出 targetLatencyMs，在开始出队前先 drop-old 丢弃超出部分。
 * 外部调用 drain() 触发出队，packet 通过 onRelease 回调交付。
 */
export class JitterBuffer {
  onRelease: ((packet: StreamingPacketPayload) => void) | null = null
  /** 启动时 drop-old 丢弃超出 targetLatencyMs 的旧包时触发，参数为丢弃包数 */
  onDropOld: ((count: number) => void) | null = null

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
   * 默认 releaseWindowMs = 60ms（覆盖 3 个 20ms tick 的余量）。
   *
   * 若尚未 started 且缓冲超出 targetLatencyMs，先 drop-old 丢弃超出部分，
   * 再开始出队，避免启动时一次性投出大量积压包。
   */
  drain(releaseWindowMs = 60): void {
    if (!this.started) {
      if (this._bufferedMs < this.targetLatencyMs) return
      // 缓冲超出 targetLatencyMs：先丢弃超出的旧包（仅当 targetLatencyMs > 0）
      if (this.targetLatencyMs > 0) {
        const excess = this._bufferedMs - this.targetLatencyMs
        if (excess > 0) {
          const dropped = this.dropOld(excess)
          if (dropped > 0) this.onDropOld?.(dropped)
        }
      }
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
