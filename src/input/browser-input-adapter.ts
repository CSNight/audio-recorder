import type {
  RecorderInputAdapter,
  RecorderInputHandlers,
  RecorderInputRequest,
  RecorderInputSession,
} from "@/input/types"
import {
  acquireMicStream,
  reportUnappliedConstraints,
} from "@/input/audio-constraints"
import { BrowserInputSession } from "@/input/browser-input-session"
import { selectInputBackend } from "@/input/backends/select"
import type { InputBackendContext } from "@/input/backends/types"
import type {
  AudioChannelCount,
  AudioInputDevice,
  RecorderInputOptions,
} from "@/types"

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

/**
 * 取流上音轨实际生效的声道数（track.getSettings().channelCount）。
 *
 * getUserMedia 的 channelCount 约束在部分浏览器中可能不生效或被忽略。
 * 这里读取硬件实际返回的声道数，以硬件实际支持为准。
 * getSettings 不上报 channelCount（部分浏览器）时回退到 fallback。
 */
function resolveTrackChannelCount(
  stream: MediaStream,
  fallback: AudioChannelCount
): AudioChannelCount {
  const track = stream.getAudioTracks()[0]
  const actual = track?.getSettings?.().channelCount
  // 支持任意正整数声道数
  if (actual != null && actual >= 1 && Number.isInteger(actual)) {
    return actual
  }
  return fallback
}

export class BrowserInputAdapter implements RecorderInputAdapter {
  async open(
    request: RecorderInputRequest,
    handlers: RecorderInputHandlers
  ): Promise<RecorderInputSession> {
    const input: RecorderInputOptions = request.input ?? {}
    const requestedChannelCount = input.channelCount ?? 1

    const stream = request.sourceStream ?? (await acquireMicStream(input))
    const ownsStream = !request.sourceStream

    if (stream.getAudioTracks().length === 0) {
      throw new Error(
        "The provided MediaStream does not contain any audio tracks."
      )
    }

    // 仅对自有麦克风流诊断约束生效情况；外部流的约束由调用方掌控
    if (ownsStream) {
      reportUnappliedConstraints(stream, input, handlers.onIssue)
    }

    // 读取硬件实际返回的声道数。注意：getUserMedia 的 channelCount 约束
    // 在部分浏览器中可能不生效，这里以硬件实际返回为准。
    const actualTrackChannelCount = resolveTrackChannelCount(
      stream,
      requestedChannelCount
    )

    const AudioContextConstructor = getAudioContextConstructor()
    const audioContext = input.sampleRate
      ? new AudioContextConstructor({ sampleRate: input.sampleRate })
      : new AudioContextConstructor()

    // 先建 session（作为 sink），再据此建立并注入 backend——显式装配，无构造期连图
    const session = new BrowserInputSession({
      audioContext,
      stream,
      handlers,
      requestedChannelCount: actualTrackChannelCount,
      ownsStream,
      disableFrameLossCompensation: input.disableFrameLossCompensation ?? false,
    })

    const context: InputBackendContext = {
      audioContext,
      stream,
      channelCount: actualTrackChannelCount,
      sink: session,
      emitIssue: handlers.onIssue,
    }

    try {
      const backend = await selectInputBackend({
        requested: input.inputStrategy ?? "auto",
        context,
      })
      session.attachBackend(backend)
    } catch (error) {
      // backend 全部失败：清理 audioContext，向上抛出
      if (audioContext.state !== "closed") {
        await audioContext.close().catch(() => undefined)
      }
      throw error
    }

    return session
  }
}
