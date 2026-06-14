import type { MaybePromise, PcmBufferSnapshot } from "@/buffer/types"
import type { AudioFrame } from "@/types"

export interface RecorderFramePipeline {
  initialize?(): MaybePromise<void>
  acceptFrame(frame: AudioFrame): void
  getSnapshot(): MaybePromise<PcmBufferSnapshot | undefined>
  reset(): MaybePromise<void>
}
