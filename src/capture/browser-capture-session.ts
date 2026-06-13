import type {
  CaptureHandlers,
  CaptureSession,
  CaptureSessionSummary,
} from "@/capture/types"
import {
  type AudioChannelCount,
  CaptureSessionState,
  RecorderWarningCode,
} from "@/types"
import { createAudioFrame, resolveChannelCount } from "@/utils/audio-frame"

export interface BrowserCaptureSessionOptions {
  audioContext: AudioContext
  stream: MediaStream
  handlers: CaptureHandlers
  requestedChannelCount: AudioChannelCount
  ownsStream: boolean
  captureNode: AudioNode
  deactivateCaptureNode: () => void
}

export class BrowserCaptureSession implements CaptureSession {
  private readonly sourceNode: MediaStreamAudioSourceNode
  private readonly sinkNode: GainNode
  private readonly ownsStream: boolean
  private readonly handlers: CaptureHandlers
  private readonly summary: CaptureSessionSummary = {
    frames: 0,
    durationMs: 0,
  }
  private readonly requestedChannelCount: AudioChannelCount
  private readonly captureNode: AudioNode
  private readonly deactivateCaptureNode: () => void
  private readonly audioContext: AudioContext
  private sessionState = CaptureSessionState.Ready
  private activeChannelCount: AudioChannelCount
  private hasWarnedChannelAdjustment = false

  constructor(options: BrowserCaptureSessionOptions) {
    this.audioContext = options.audioContext
    this.handlers = options.handlers
    this.requestedChannelCount = options.requestedChannelCount
    this.activeChannelCount = options.requestedChannelCount
    this.ownsStream = options.ownsStream
    this.captureNode = options.captureNode
    this.deactivateCaptureNode = options.deactivateCaptureNode

    this.sourceNode = options.audioContext.createMediaStreamSource(
      options.stream
    )
    this.sinkNode = options.audioContext.createGain()
    this.sinkNode.gain.value = 0

    // 采集链路仍要接到 destination 才能稳定驱动部分浏览器的处理回调，但输出增益固定为 0。
    this.sourceNode.connect(this.captureNode)
    this.captureNode.connect(this.sinkNode)
    this.sinkNode.connect(options.audioContext.destination)
  }

  get actualSampleRate(): number {
    return this.audioContext.sampleRate
  }

  get actualChannelCount(): AudioChannelCount {
    return this.activeChannelCount
  }

  acceptFrame(planarFloat: readonly Float32Array[], timestamp: number): void {
    if (this.sessionState !== CaptureSessionState.Recording) {
      // Ready / Paused / Stopped 状态下收到的浏览器回调全部丢弃，避免污染摘要。
      return
    }

    const nextChannelCount = resolveChannelCount(planarFloat.length)
    this.activeChannelCount = nextChannelCount
    this.reportChannelCountAdjustmentIfNeeded(nextChannelCount)

    const frame = createAudioFrame(
      planarFloat,
      this.audioContext.sampleRate,
      timestamp
    )

    // Session 侧先累计原始统计，再把结构化帧抛给控制器。
    this.summary.frames += 1
    this.summary.durationMs += frame.durationMs
    this.handlers.onFrame(frame)
  }

  async start(): Promise<void> {
    this.assertState([
      CaptureSessionState.Ready,
      CaptureSessionState.Stopped,
      CaptureSessionState.Paused,
    ])
    this.sessionState = CaptureSessionState.Recording
    await this.audioContext.resume()
  }

  pause(): void {
    this.assertState([CaptureSessionState.Recording])
    this.sessionState = CaptureSessionState.Paused
  }

  async resume(): Promise<void> {
    this.assertState([CaptureSessionState.Paused])
    this.sessionState = CaptureSessionState.Recording
    await this.audioContext.resume()
  }

  async stop(): Promise<CaptureSessionSummary> {
    this.assertState([
      CaptureSessionState.Recording,
      CaptureSessionState.Paused,
      CaptureSessionState.Ready,
      CaptureSessionState.Stopped,
    ])
    this.sessionState = CaptureSessionState.Stopped

    return {
      frames: this.summary.frames,
      durationMs: this.summary.durationMs,
    }
  }

  async close(): Promise<void> {
    if (this.sessionState === CaptureSessionState.Closed) {
      return
    }

    this.sessionState = CaptureSessionState.Closed
    // 先注销回调，再断开节点，避免关闭途中还有迟到的帧回流。
    this.deactivateCaptureNode()
    this.sourceNode.disconnect()
    this.captureNode.disconnect()
    this.sinkNode.disconnect()

    if (this.ownsStream) {
      // 只有适配器自己申请的麦克风流才负责 stop；外部传入的流由宿主管理生命周期。
      for (const track of this.sourceNode.mediaStream.getTracks()) {
        track.stop()
      }
    }

    if (this.audioContext.state !== "closed") {
      await this.audioContext.close()
    }
  }

  private assertState(allowedStates: CaptureSessionState[]): void {
    if (allowedStates.includes(this.sessionState)) {
      return
    }

    throw new Error(
      `Capture session state "${this.sessionState}" does not allow this operation.`
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
    // 声道数不匹配只告警一次，避免每帧重复刷屏。
    this.handlers.onIssue({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.ChannelCountAdjusted,
        message: `Requested ${this.requestedChannelCount} channel(s) but the active stream reported ${actualChannelCount}.`,
      },
    })
  }
}
