import type { InputIssue } from "@/input/types"
import { type RecorderInputOptions, RecorderWarningCode } from "@/types"

/**
 * 由录音输入参数构建 getUserMedia 音频约束。
 *
 * - 三处理项（AEC/NS/AGC）默认全开，确保多数浏览器/移动端行为一致；
 * - channelCount / deviceId 仅显式传入时写入，且使用 { exact } 强约束：
 *   声道数交给原生协商（避免历史上为强制声道数而绕 Web Audio 图的做法）。
 */
export function buildAudioConstraints(
  input: RecorderInputOptions,
  options: { exactChannelCount?: boolean } = {}
): MediaTrackConstraints {
  const exactChannelCount = options.exactChannelCount ?? true
  return {
    echoCancellation: input.echoCancellation ?? true,
    noiseSuppression: input.noiseSuppression ?? true,
    autoGainControl: input.autoGainControl ?? true,
    ...(input.sampleRate !== undefined && { sampleRate: input.sampleRate }),
    ...(input.channelCount !== undefined && {
      channelCount: exactChannelCount
        ? { exact: input.channelCount }
        : input.channelCount,
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
 * 获取麦克风流。首次以 { exact } 声道约束请求；若设备不支持（OverconstrainedError，
 * 例如蓝牙 HFP 单声道设备被请求双声道），发 AudioConstraintNotApplied 警告后
 * 去掉 exact 重试一次，保证 open() 不因声道数硬失败。
 */
export async function acquireMicStream(
  input: RecorderInputOptions,
  emitIssue: (issue: InputIssue) => void
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
    if (!isOverconstrainedError(error) || input.channelCount === undefined) {
      throw error
    }
    emitIssue({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.AudioConstraintNotApplied,
        message: `Device does not support exact channelCount ${input.channelCount}; retrying without exact constraint.`,
      },
    })
    return navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints(input, { exactChannelCount: false }),
      video: false,
    })
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
  emitIssue: (issue: InputIssue) => void
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
