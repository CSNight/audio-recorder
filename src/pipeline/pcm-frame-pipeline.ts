import { InMemoryPcmBufferStore } from "@/buffer/in-memory-pcm-buffer-store"
import type { PcmBufferStore } from "@/buffer/types"
import type { RecorderFramePipeline } from "@/pipeline/types"
import type { AudioFrame } from "@/types"

export class PcmFramePipeline implements RecorderFramePipeline {
  constructor(
    private readonly bufferStore: PcmBufferStore = new InMemoryPcmBufferStore()
  ) {}

  initialize() {
    // 管线本身不持有额外状态，只把初始化职责透传给底层 buffer store。
    return this.bufferStore.initialize?.()
  }

  acceptFrame(frame: AudioFrame): void {
    this.bufferStore.appendFrame(frame)
  }

  getSnapshot() {
    return this.bufferStore.snapshot()
  }

  reset() {
    // reset 同时承担“清空内存快照”和“关闭持久化 session”两类职责。
    return this.bufferStore.clear()
  }
}
