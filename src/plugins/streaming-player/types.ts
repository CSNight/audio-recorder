/**
 * streaming-player 公共类型定义
 */

import type { StreamingPacketPayload } from "../streaming-export"
import type { PersistStore } from "./persist-store"
import type { AudioDecoderDefinition } from "../../types"

export type { StreamingPacketPayload, AudioDecoderDefinition }

/** 播放器状态 */
export type StreamingPlayerState =
  | "idle"
  | "buffering"
  | "playing"
  | "paused"
  | "stopped"

/** 持久化模式 */
export type PersistMode = "memory" | "indexeddb" | "custom"

/** createStreamingPlayer 选项 */
export interface StreamingPlayerOptions {
  /**
   * 解码器列表（必填）。
   */
  decoders: AudioDecoderDefinition[]
  /** 目标播放延迟（毫秒），默认 300 */
  targetLatencyMs?: number
  /** 最大缓冲量（毫秒），超出后丢弃旧包，默认 3000 */
  maxBufferMs?: number
  /** 初始音量 [0, 1]，默认 1.0 */
  volume?: number
  /**
   * 持久化模式，默认 "memory"。
   * - "memory"：使用内存环形缓冲（MemoryPersistStore）
   * - "indexeddb"：旁路写入 IndexedDB；当前 recent() 仍只读内存镜像，
   *   因此不支持跨页面刷新后读回重播
   * - "custom"：由调用方通过 `player.use(store)` 显式注册自定义 PersistStore
   */
  persistMode?: PersistMode
  /**
   * 持久化存储最大时长（毫秒），默认 10000。
   * 仅对内置 `"memory"` / `"indexeddb"` 生效；`"custom"` 模式下由用户自行控制。
   */
  persistBufferMs?: number
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
  /** 当前整条播放管线的总余量（毫秒） */
  readonly bufferedMs: number
  /** 已丢弃的 packet 总数 */
  readonly droppedPackets: number
  /** 持久化存储中已存储的音频时长（毫秒），可用于显示可重播时长 */
  readonly storedMs: number
  /** 状态变化回调，可在创建后直接赋值，null 表示不监听 */
  onStateChange: ((state: StreamingPlayerState) => void) | null

  /**
   * 注册自定义 PersistStore。
   * 仅 `persistMode === "custom"` 时可用，且必须在首次 `push()` / `start()` 前调用一次。
   */
  use(store: PersistStore): void

  /**
   * 向 player 推送一个编码 packet。
   * 业务层在订阅 recorder / websocket 事件后调用此方法。
   * idle / paused 时仅写入历史缓存；开始播放后才进入实时播放管线。
   */
  push(packet: StreamingPacketPayload): void

  /** 开始播放（默认从 live edge 起播，并用最近一个小窗口作为启动垫片） */
  start(): Promise<void>

  /** 暂停（暂停期间的 packet 只写入持久化存储，不进入播放管线） */
  pause(): void

  /** 恢复播放（清除积压，从当前时刻重新缓冲） */
  resume(): void

  /** 设置音量 [0, 1] */
  setVolume(volume: number): void

  /** 销毁 player，释放所有资源 */
  destroy(): void

  /**
   * 重播最近 N 秒的历史音频。
   * 只能在暂停状态下调用，播放完毕后保持暂停。
   */
  replay(seconds: number): void
}
