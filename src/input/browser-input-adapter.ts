import type {
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputRequest,
  RecorderInputSession,
} from "@/input/types"
import { BrowserInputSession } from "@/input/browser-input-session"
import { createInputGraph } from "@/input/input-graph"
import type { AudioInputDevice, RecorderInputOptions } from "@/types"

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

  return audioContextConstructor
}

function buildConstraints(input: RecorderInputOptions): MediaTrackConstraints {
  return {
    // 三项音频处理默认全开，确保多数浏览器/移动端行为一致
    echoCancellation: input.echoCancellation ?? true,
    noiseSuppression: input.noiseSuppression ?? true,
    autoGainControl: input.autoGainControl ?? true,
    // 以下仅用户显式传入时才写入约束
    ...(input.sampleRate !== undefined && { sampleRate: input.sampleRate }),
    ...(input.channelCount !== undefined && {
      channelCount: input.channelCount,
    }),
    ...(input.deviceId !== undefined && {
      deviceId: { exact: input.deviceId },
    }),
  }
}

/**
 * 列举当前可用的麦克风（音频输入）设备。
 *
 * 注意：在用户授权麦克风权限之前，返回的设备条目 `label` 字段为空字符串。
 * 建议在首次 `recorder.open()` 成功后再次调用本函数以刷新设备标签。
 */
export async function listMicrophoneDevices(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error(
      "navigator.mediaDevices.enumerateDevices is not available in the current environment."
    )
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId }))
}

export class BrowserInputAdapter implements RecorderInputAdapter {
  async open(
    request: RecorderInputRequest,
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession> {
    const input = request.input ?? {}
    const requestedChannelCount = input.channelCount ?? 1
    const stream =
      request.sourceStream ?? (await this.getUserMediaStream(input))
    const ownsStream = !request.sourceStream
    const audioTracks = stream.getAudioTracks()

    if (audioTracks.length === 0) {
      throw new Error(
        "The provided MediaStream does not contain any audio tracks."
      )
    }

    const AudioContextConstructor = getAudioContextConstructor()
    const audioContext = input.sampleRate
      ? new AudioContextConstructor({ sampleRate: input.sampleRate })
      : new AudioContextConstructor()

    const inputGraph = await createInputGraph(
      audioContext,
      requestedChannelCount,
      handlers
    )

    const session = new BrowserInputSession({
      audioContext,
      stream,
      handlers,
      requestedChannelCount,
      ownsStream,
      inputNode: inputGraph.inputNode,
      deactivateInputNode: inputGraph.deactivateInputNode,
      disableEnvInFix: input.frameLossCompensation ?? false,
    })

    inputGraph.bindSession(session)
    return session
  }

  private async getUserMediaStream(
    input: RecorderInputOptions
  ): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("navigator.mediaDevices.getUserMedia is not available.")
    }

    return navigator.mediaDevices.getUserMedia({
      audio: buildConstraints(input),
      video: false,
    })
  }
}
