/**
 * streaming-player 公共类型定义
 *
 * 设计原则：
 * - 业务层负责事件订阅/WebSocket/Recorder桥接，plugin 只消费 packet 流
 * - decoders 由用户从主库 codecs 导入后注入
 * - 不依赖 SharedArrayBuffer
 */

import type { StreamingPacketPayload } from "@/plugins/streaming-export/types"
import type { AudioDecoderDefinition } from "@/types"

export type { StreamingPacketPayload, AudioDecoderDefinition }

/** 播放器状态 */
export type StreamingPlayerState =
  | "idle"
  | "buffering"
  | "playing"
  | "paused"
  | "stopped"

/** createStreamingPlayer 选项 */
export interface StreamingPlayerOptions {
  /**
   * 解码器列表（必填）。
   * 使用主库 codecs 中导出的 AudioDecoderDefinition，在业务层注入。
   * 例：decoders: [pcmDecoderDefinition, wavDecoderDefinition]
   */
  decoders: AudioDecoderDefinition[]
  /** 目标播放延迟（毫秒），默认 300 */
  targetLatencyMs?: number
  /** 最大缓冲量（毫秒），超出后触发 backlogPolicy，默认 3000 */
  maxBufferMs?: number
  /** 积压策略：默认 drop-old */
  backlogPolicy?: "wait" | "drop-old"
  /** 初始音量 [0, 1]，默认 1.0 */
  volume?: number
  /** 创建后是否自动开始播放（等待缓冲充足），默认 true */
  autoPlay?: boolean
  /** AudioContext，不传则内部创建 */
  audioContext?: AudioContext
  /** 欠载回调：解码队列空时触发 */
  onUnderrun?: (detail: { bufferedMs: number }) => void
  /** 丢包回调 */
  onPacketDrop?: (detail: { count: number; reason: string }) => void
  /** 状态变化回调 */
  onStateChange?: (state: StreamingPlayerState) => void
}

/** createStreamingPlayer 返回的控制句柄 */
export interface StreamingPlayerHandle {
  /** 当前播放状态 */
  readonly state: StreamingPlayerState
  /** 当前缓冲量（毫秒） */
  readonly bufferedMs: number
  /** 已丢弃的 packet 总数 */
  readonly droppedPackets: number
  /**
   * 向 player 推送一个编码 packet。
   * 业务层在订阅 recorder / websocket 事件后调用此方法。
   */
  push(packet: StreamingPacketPayload): void
  /** 开始播放（等待缓冲充足后自动切换 playing） */
  start(): Promise<void>
  /** 暂停 */
  pause(): void
  /** 恢复播放 */
  resume(): void
  /** 设置音量 [0, 1] */
  setVolume(volume: number): void
  /** 销毁 player，释放所有资源 */
  destroy(): void
  /** 重播最近 N 秒的 packet */
  replay(seconds: number): void
  /** 状态变化回调，可在创建后直接赋值，null 表示不监听 */
  onStateChange: ((state: StreamingPlayerState) => void) | null
}
