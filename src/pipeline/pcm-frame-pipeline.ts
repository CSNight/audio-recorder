import { InMemoryPcmBufferStore } from "@/buffer/in-memory-pcm-buffer-store"
import type { PcmBufferStore } from "@/buffer/types"
import type { RecorderFramePipeline } from "@/pipeline/types"
import type { AudioFrame } from "@/types"

export class PcmFramePipeline implements RecorderFramePipeline {
  constructor(
    private readonly bufferStore: PcmBufferStore = new InMemoryPcmBufferStore()
  ) {}

  initialize() {
    return this.bufferStore.initialize?.()
  }

  acceptFrame(frame: AudioFrame): void {
    this.bufferStore.appendFrame(frame)
  }

  getSnapshot() {
    return this.bufferStore.snapshot()
  }

  reset() {
    return this.bufferStore.clear()
  }
}
