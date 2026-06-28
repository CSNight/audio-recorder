import type { InputBackend, InputFrameSink } from "@/input/backends/types"
import type {
  InputSessionSummary,
  RecorderInputHandlers,
  RecorderInputSession,
} from "@/input/types"
import {
  type AudioChannelCount,
  type RecorderInputStrategy,
  RecorderWarningCode,
} from "@/types"
import { createAudioFrame, resolveChannelCount } from "@/utils/audio-frame"

const enum InputSessionState {
  Ready = "ready",
  Recording = "recording",
  Paused = "paused",
  Stopped = "stopped",
  Closed = "closed",
}

export interface BrowserInputSessionOptions {
  audioContext: AudioContext
  stream: MediaStream
  handlers: RecorderInputHandlers
  requestedChannelCount: AudioChannelCount
  ownsStream: boolean
  disableEnvInFix: boolean
}

/**
 * 单次底层采集会话。作为 InputFrameSink 接收所选 InputBackend 推来的原始 float 帧，
 * 负责状态门控、丢帧补偿与 Int16 帧生成。
 *
 * 装配顺序：先构造 session（作为 sink 建立 backend），再通过 attachBackend 注入 backend，
 * 不在构造函数内隐式连图，时序显式可控。
 */
export class BrowserInputSession
  implements RecorderInputSession, InputFrameSink
{
  private readonly audioContext: AudioContext
  private readonly stream: MediaStream
  private readonly handlers: RecorderInputHandlers
  private readonly requestedChannelCount: AudioChannelCount
  private readonly ownsStream: boolean
  private readonly disableEnvInFix: boolean

  private backend: InputBackend | undefined
  private sessionState = InputSessionState.Ready
  private activeChannelCount: AudioChannelCount
  private hasWarnedChannelAdjustment = false
  private readonly summary: InputSessionSummary = { frames: 0, durationMs: 0 }

  // 丢帧补偿滑动窗口
  private envInFixTs: Array<{ t: number; d: number }> = []
  private envInFix = 0

  constructor(options: BrowserInputSessionOptions) {
    this.audioContext = options.audioContext
    this.stream = options.stream
    this.handlers = options.handlers
    this.requestedChannelCount = options.requestedChannelCount
    this.activeChannelCount = options.requestedChannelCount
    this.ownsStream = options.ownsStream
    this.disableEnvInFix = options.disableEnvInFix
  }

  get actualSampleRate(): number {
    return this.audioContext.sampleRate
  }

  get actualChannelCount(): AudioChannelCount {
    return this.activeChannelCount
  }

  get actualInputStrategy(): RecorderInputStrategy {
    if (!this.backend) {
      throw new Error("Input backend has not been attached.")
    }
    return this.backend.strategy
  }

  /** 注入已建立的采集 backend（由适配器在 selectInputBackend 成功后调用）。 */
  attachBackend(backend: InputBackend): void {
    this.backend = backend
  }

  acceptFrame(
    planarFloat: readonly Float32Array[],
    timestamp: number,
    sampleRate = this.audioContext.sampleRate
  ): void {
    if (this.sessionState !== InputSessionState.Recording) {
      return
    }

    const now = performance.now()
    const frameLength = planarFloat[0]?.length ?? 0
    const pcmTime = Math.round((frameLength / sampleRate) * 1000)

    // 更新滑动窗口（头部插入当前帧记录）
    const fixTs = this.envInFixTs
    fixTs.unshift({ t: now, d: pcmTime })

    // 清理超过 3 秒的记录，统计窗口内 tsInStart 和 tsPcm
    let tsInStart = now
    let tsPcm = 0
    for (let i = 0; i < fixTs.length; i++) {
      if (now - fixTs[i]!.t > 3000) {
        fixTs.length = i
        break
      }
      tsInStart = fixTs[i]!.t
      tsPcm += fixTs[i]!.d
    }

    const tsInPrev = fixTs[1]
    const tsIn = now - tsInStart
    const lost = tsIn - tsPcm

    // 双重门槛检测：丢失超过 1/3 且冷启动保护通过
    if (lost > tsIn / 3 && ((tsInPrev && tsIn > 1000) || fixTs.length >= 6)) {
      const addTime = now - tsInPrev!.t - pcmTime
      if (addTime > pcmTime / 5) {
        this.envInFix += addTime

        this.handlers.onIssue({
          kind: "warning",
          warning: {
            code: RecorderWarningCode.FrameLossDetected,
            message: `Frame loss detected: ${Math.round(addTime)}ms gap. Total compensated: ${Math.round(this.envInFix)}ms. Compensation ${this.disableEnvInFix ? "disabled" : "applied"}.`,
          },
        })

        if (!this.disableEnvInFix) {
          const silentSamples = Math.round((addTime * sampleRate) / 1000)
          const silentChannel = new Float32Array(silentSamples)
          const silentPlanar = Array.from(
            { length: planarFloat.length },
            () => silentChannel
          )
          this.processFrame(silentPlanar, now, sampleRate)
        }
      }
    }

    this.processFrame(planarFloat, timestamp, sampleRate)
  }

  async start(): Promise<void> {
    this.assertState([
      InputSessionState.Ready,
      InputSessionState.Stopped,
      InputSessionState.Paused,
    ])
    this.envInFixTs = []
    this.sessionState = InputSessionState.Recording
    this.backend?.resume()
    await this.audioContext.resume()
  }

  pause(): void {
    this.assertState([InputSessionState.Recording])
    this.sessionState = InputSessionState.Paused
    this.backend?.suspend()
  }

  async resume(): Promise<void> {
    this.assertState([InputSessionState.Paused])
    this.envInFixTs = []
    this.sessionState = InputSessionState.Recording
    this.backend?.resume()
    await this.audioContext.resume()
  }

  async stop(): Promise<InputSessionSummary> {
    this.assertState([
      InputSessionState.Recording,
      InputSessionState.Paused,
      InputSessionState.Ready,
      InputSessionState.Stopped,
    ])
    this.sessionState = InputSessionState.Stopped
    this.backend?.suspend()

    return {
      frames: this.summary.frames,
      durationMs: this.summary.durationMs,
    }
  }

  async close(): Promise<void> {
    if (this.sessionState === InputSessionState.Closed) {
      return
    }

    this.sessionState = InputSessionState.Closed
    this.backend?.dispose()

    if (this.ownsStream) {
      for (const track of this.stream.getTracks()) {
        track.stop()
      }
    }

    if (this.audioContext.state !== "closed") {
      await this.audioContext.close()
    }
  }

  private processFrame(
    planarFloat: readonly Float32Array[],
    timestamp: number,
    sampleRate: number
  ): void {
    const nextChannelCount = resolveChannelCount(planarFloat.length)
    this.activeChannelCount = nextChannelCount
    this.reportChannelCountAdjustmentIfNeeded(nextChannelCount)

    const frame = createAudioFrame(planarFloat, sampleRate, timestamp)

    this.summary.frames += 1
    this.summary.durationMs += frame.durationMs
    this.handlers.onFrame(frame)
  }

  private assertState(allowedStates: InputSessionState[]): void {
    if (allowedStates.includes(this.sessionState)) {
      return
    }

    throw new Error(
      `Input session state "${this.sessionState}" does not allow this operation.`
    )
  }

  private reportChannelCountAdjustmentIfNeeded(
    actualChannelCount: AudioChannelCount
  ): void {
    if (
      this.hasWarnedChannelAdjustment ||
      actualChannelCount === this.requestedChannelCount
    ) {
      return
    }

    this.hasWarnedChannelAdjustment = true
    this.handlers.onIssue({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.ChannelCountAdjusted,
        message: `Requested ${this.requestedChannelCount} channel(s) but the active stream reported ${actualChannelCount}.`,
      },
    })
  }
}
