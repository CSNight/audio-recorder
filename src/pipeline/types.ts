import type { MaybePromise, PcmBufferSnapshot } from "@/buffer/types"
import type { AudioFrame } from "@/types"

/**
 * 录音帧处理管线接口。
 *
 * 管线负责接收每一帧原始 PCM 数据（Int16 planar），将其暂存到底层 buffer store，
 * 并在导出时提供完整的 PcmBufferSnapshot。
 *
 * 生命周期：initialize → [acceptFrame]* → getSnapshot → reset
 */
export interface RecorderFramePipeline {
  /** 可选初始化钩子，用于打开持久化 session 等异步准备工作。 */
  initialize?(): MaybePromise<void>
  /** 将一帧 PCM 数据追加到内部 buffer。 */
  acceptFrame(frame: AudioFrame): void
  /** 返回当前所有帧的完整快照，供编码器消费；若尚无数据则返回 undefined。 */
  getSnapshot(): MaybePromise<PcmBufferSnapshot | undefined>
  /** 清空缓冲区并关闭持久化 session，为下一次录音复位。 */
  reset(): MaybePromise<void>
}
