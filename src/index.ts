import { BrowserCaptureAdapter } from "@/capture/browser-capture-adapter"
import { RecorderController } from "@/core/recorder-controller"
import type { CreateRecorderOptions } from "@/types"

export type {
  AudioCaptureOptions,
  AudioChannelCount,
  AudioFrame,
  CreateRecorderOptions,
  RecorderEventMap,
  RecorderFrameEvent,
  RecorderIssue,
  RecorderIssueEvent,
  RecorderOpenOptions,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
  RecorderStateChangeEvent,
  RecorderWarning,
} from "@/types"
export {
  RecorderInputSource,
  RecorderState,
  RecorderWarningCode,
} from "@/types"

export { RecorderController } from "@/core/recorder-controller"

export function createRecorder(
  options: CreateRecorderOptions = {}
): RecorderController {
  // 默认走浏览器采集适配器；测试或宿主接入时可注入自定义适配器替换底层采集实现。
  return new RecorderController({
    captureAdapter: options.captureAdapter ?? new BrowserCaptureAdapter(),
  })
}
