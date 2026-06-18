import type {
  RecorderInputHandlers,
  RecorderInputSession,
  InputSessionSummary,
} from "@/input/types"
import { type AudioChannelCount, RecorderWarningCode } from "@/types"
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
  inputNode: AudioNode
  deactivateInputNode: () => void
  disableEnvInFix: boolean
}

export class BrowserInputSession implements RecorderInputSession {
  private readonly sourceNode: MediaStreamAudioSourceNode
  private readonly sinkNode: GainNode
  private readonly ownsStream: boolean
  private readonly handlers: RecorderInputHandlers
  private readonly summary: InputSessionSummary = {
    frames: 0,
    durationMs: 0,
  }
  private readonly requestedChannelCount: AudioChannelCount
  private readonly inputNode: AudioNode
  private readonly deactivateInputNode: () => void
  private readonly audioContext: AudioContext
  private readonly disableEnvInFix: boolean
  private sessionState = InputSessionState.Ready
  private activeChannelCount: AudioChannelCount
  private hasWarnedChannelAdjustment = false
  // 丢帧补偿滑动窗口
  private envInFixTs: Array<{ t: number; d: number }> = []
  private envInFix = 0

  constructor(options: BrowserInputSessionOptions) {
    this.audioContext = options.audioContext
    this.handlers = options.handlers
    this.requestedChannelCount = options.requestedChannelCount
    this.activeChannelCount = options.requestedChannelCount
    this.ownsStream = options.ownsStream
    this.inputNode = options.inputNode
    this.deactivateInputNode = options.deactivateInputNode
    this.disableEnvInFix = options.disableEnvInFix

    this.sourceNode = options.audioContext.createMediaStreamSource(
      options.stream
    )
    this.sinkNode = options.audioContext.createGain()
    this.sinkNode.gain.value = 0

    this.sourceNode.connect(this.inputNode)
    this.inputNode.connect(this.sinkNode)
    this.sinkNode.connect(options.audioContext.destination)
  }

  get actualSampleRate(): number {
    return this.audioContext.sampleRate
  }

  get actualChannelCount(): AudioChannelCount {
    return this.activeChannelCount
  }

  acceptFrame(planarFloat: readonly Float32Array[], timestamp: number): void {
    if (this.sessionState !== InputSessionState.Recording) {
      return
    }

    const now = performance.now()
    const sampleRate = this.audioContext.sampleRate
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
          this.processFrame(silentPlanar, now)
        }
      }
    }

    this.processFrame(planarFloat, timestamp)
  }

  private processFrame(
    planarFloat: readonly Float32Array[],
    timestamp: number
  ): void {
    const nextChannelCount = resolveChannelCount(planarFloat.length)
    this.activeChannelCount = nextChannelCount
    this.reportChannelCountAdjustmentIfNeeded(nextChannelCount)

    const frame = createAudioFrame(
      planarFloat,
      this.audioContext.sampleRate,
      timestamp
    )

    this.summary.frames += 1
    this.summary.durationMs += frame.durationMs
    this.handlers.onFrame(frame)
  }

  async start(): Promise<void> {
    this.assertState([
      InputSessionState.Ready,
      InputSessionState.Stopped,
      InputSessionState.Paused,
    ])
    this.envInFixTs = []
    this.sessionState = InputSessionState.Recording
    await this.audioContext.resume()
  }

  pause(): void {
    this.assertState([InputSessionState.Recording])
    this.sessionState = InputSessionState.Paused
  }

  async resume(): Promise<void> {
    this.assertState([InputSessionState.Paused])
    this.envInFixTs = []
    this.sessionState = InputSessionState.Recording
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
    this.deactivateInputNode()
    this.sourceNode.disconnect()
    this.inputNode.disconnect()
    this.sinkNode.disconnect()

    if (this.ownsStream) {
      for (const track of this.sourceNode.mediaStream.getTracks()) {
        track.stop()
      }
    }

    if (this.audioContext.state !== "closed") {
      await this.audioContext.close()
    }
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
