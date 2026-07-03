import type { AudioFrame } from "../types"

export type MaybePromise<T> = T | Promise<T>

/** 某一时刻 PCM 缓冲区的快照，用于编码导出。 */
export interface PcmBufferSnapshot {
  /** 采样率（Hz），通常与 AudioContext.sampleRate 一致。 */
  sampleRate: number
  /** 声道数（1 = 单声道，2 = 立体声）。 */
  channels: number
  /** 快照包含的 AudioFrame 帧数。 */
  frameCount: number
  /** 快照对应的音频时长（毫秒）。 */
  durationMs: number
  /** 各声道 Int16 PCM 数据，平面格式（每个元素对应一个声道）。 */
  planar: Int16Array[]
}

/** PCM 帧缓冲存储接口，内存和持久化实现共享此约定。 */
export interface PcmBufferStore {
  /** 初始化存储（可选），可用于建立持久化 session 等异步资源。 */
  initialize?(): MaybePromise<void>
  /** 追加一帧 PCM 数据到缓冲区。 */
  appendFrame(frame: AudioFrame): void
  /** 返回当前所有帧的快照；缓冲为空时返回 undefined。 */
  snapshot(): MaybePromise<PcmBufferSnapshot | undefined>
  /** 清空缓冲区，释放持久化资源（如 IndexedDB session）。 */
  clear(): MaybePromise<void>
}
