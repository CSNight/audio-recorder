import type {
  CaptureAdapter,
  CaptureHandlers,
  CaptureOpenRequest,
  CaptureSession,
} from "@/capture/types"
import { BrowserCaptureSession } from "@/capture/browser-capture-session"
import { createCaptureGraph } from "@/capture/capture-graph"

type AudioContextConstructor = typeof AudioContext
type AudioContextScope = typeof globalThis & {
  webkitAudioContext?: AudioContextConstructor
}

function getAudioContextConstructor(): AudioContextConstructor {
  const scope = globalThis as AudioContextScope
  const audioContextConstructor = scope.AudioContext ?? scope.webkitAudioContext

  if (!audioContextConstructor) {
    throw new Error("AudioContext is not available in the current environment.")
  }

  // 同时兼容标准 AudioContext 和旧版 Safari 的 webkitAudioContext。
  return audioContextConstructor
}

function createConstraints(
  capture: CaptureOpenRequest["capture"]
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {}

  // 只透传显式声明的采集参数，避免把 undefined 约束误传给浏览器。
  if (capture?.sampleRate !== undefined) {
    constraints.sampleRate = capture.sampleRate
  }
  if (capture?.channelCount !== undefined) {
    constraints.channelCount = capture.channelCount
  }
  if (capture?.echoCancellation !== undefined) {
    constraints.echoCancellation = capture.echoCancellation
  }
  if (capture?.noiseSuppression !== undefined) {
    constraints.noiseSuppression = capture.noiseSuppression
  }
  if (capture?.autoGainControl !== undefined) {
    constraints.autoGainControl = capture.autoGainControl
  }

  return constraints
}

export class BrowserCaptureAdapter implements CaptureAdapter {
  async open(
    request: CaptureOpenRequest,
    handlers: CaptureHandlers
  ): Promise<CaptureSession> {
    const requestedChannelCount = request.capture?.channelCount ?? 1
    // 外部流优先复用宿主提供的 MediaStream；未提供时才主动申请麦克风权限。
    const stream =
      request.sourceStream ?? (await this.getUserMediaStream(request.capture))
    const ownsStream = !request.sourceStream
    const audioTracks = stream.getAudioTracks()

    if (audioTracks.length === 0) {
      throw new Error(
        "The provided MediaStream does not contain any audio tracks."
      )
    }

    const AudioContextConstructor = getAudioContextConstructor()
    const audioContext = request.capture?.sampleRate
      ? new AudioContextConstructor({
          // 指定采样率时尽量让 AudioContext 从入口阶段就对齐目标值。
          sampleRate: request.capture.sampleRate,
        })
      : new AudioContextConstructor()

    const captureGraph = await createCaptureGraph(
      audioContext,
      requestedChannelCount,
      handlers
    )

    const session = new BrowserCaptureSession({
      audioContext,
      stream,
      handlers,
      requestedChannelCount,
      ownsStream,
      captureNode: captureGraph.captureNode,
      deactivateCaptureNode: captureGraph.deactivateCaptureNode,
    })

    captureGraph.bindSession(session)
    return session
  }

  private async getUserMediaStream(
    capture?: CaptureOpenRequest["capture"]
  ): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("navigator.mediaDevices.getUserMedia is not available.")
    }

    // 当前阶段只申请音频输入，视频始终关闭，约束由 createConstraints 统一构造。
    return navigator.mediaDevices.getUserMedia({
      audio: createConstraints(capture),
      video: false,
    })
  }
}
