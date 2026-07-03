import {
  type RecorderInputOptions,
  type RecorderIssue,
  RecorderWarningCode,
} from "../types"

/**
 * 由录音输入参数构建 getUserMedia 音频约束。
 *
 * - 三处理项（AEC/NS/AGC）默认全开，确保多数浏览器/移动端行为一致；
 * - channelCount 仅显式传入时写入，使用 { exact } 强约束：声道数由原生设备协商，
 *   设备无法满足时 getUserMedia 会诚实抛 OverconstrainedError（不静默降级）；
 * - deviceId 用 { exact }。
 */
export function buildAudioConstraints(
  input: RecorderInputOptions
): MediaTrackConstraints {
  return {
    echoCancellation: input.echoCancellation ?? true,
    noiseSuppression: input.noiseSuppression ?? true,
    autoGainControl: input.autoGainControl ?? true,
    ...(input.sampleRate !== undefined && { sampleRate: input.sampleRate }),
    ...(input.channelCount !== undefined && {
      channelCount: { exact: input.channelCount },
    }),
    ...(input.deviceId !== undefined && {
      deviceId: { exact: input.deviceId },
    }),
  }
}

function isOverconstrainedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "OverconstrainedError"
  )
}

/**
 * 获取麦克风流。以 { exact } 声道约束请求；若设备无法满足用户要求的声道数
 * （OverconstrainedError，例如蓝牙 HFP 单声道设备被请求双声道），**不再静默降级**——
 * 直接抛出错误中止录音，由调用方将其作为 error 事件上报。用户显式要求的声道数
 * 拿不到属于硬失败，不应悄悄回退成另一个声道数继续录。
 */
export async function acquireMicStream(
  input: RecorderInputOptions
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("navigator.mediaDevices.getUserMedia is not available.")
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints(input),
      video: false,
    })
  } catch (error) {
    if (isOverconstrainedError(error) && input.channelCount !== undefined) {
      throw new Error(
        `Device does not support the requested channelCount ${input.channelCount}. ` +
          `Recording aborted (set a channelCount the device supports, e.g. 1).`,
        { cause: error }
      )
    }
    throw error
  }
}

/**
 * 比对请求的音频约束与浏览器实际生效值，对未生效的项发出诊断告警。
 *
 * 仅对自有麦克风流有意义：外部流的约束由调用方掌控。三个布尔处理项（AEC/NS/AGC）
 * 与 channelCount 通过 MediaStreamTrack.getSettings() 读取实际值；浏览器不一定
 * 上报每一项（settings 中缺失则跳过，不误报）。
 */
export function reportUnappliedConstraints(
  stream: MediaStream,
  input: RecorderInputOptions,
  emitIssue: (issue: RecorderIssue) => void
): void {
  const track = stream.getAudioTracks()[0]
  if (!track?.getSettings) {
    return
  }

  const settings = track.getSettings() as MediaTrackSettings & {
    echoCancellation?: boolean
    noiseSuppression?: boolean
    autoGainControl?: boolean
  }

  const mismatches: string[] = []

  const checkBoolean = (
    label: string,
    requested: boolean,
    actual: boolean | undefined
  ): void => {
    if (actual !== undefined && actual !== requested) {
      mismatches.push(`${label}: requested ${requested}, actual ${actual}`)
    }
  }

  checkBoolean(
    "echoCancellation",
    input.echoCancellation ?? true,
    settings.echoCancellation
  )
  checkBoolean(
    "noiseSuppression",
    input.noiseSuppression ?? true,
    settings.noiseSuppression
  )
  checkBoolean(
    "autoGainControl",
    input.autoGainControl ?? true,
    settings.autoGainControl
  )

  if (
    input.channelCount !== undefined &&
    settings.channelCount !== undefined &&
    settings.channelCount !== input.channelCount
  ) {
    mismatches.push(
      `channelCount: requested ${input.channelCount}, actual ${settings.channelCount}`
    )
  }

  if (mismatches.length === 0) {
    return
  }

  emitIssue({
    kind: "warning",
    warning: {
      code: RecorderWarningCode.AudioConstraintNotApplied,
      message: `Some audio constraints were not applied by the browser: ${mismatches.join("; ")}.`,
    },
  })
}
