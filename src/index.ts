import { BrowserCaptureAdapter } from "./capture/browser-capture-adapter"
import { RecorderController } from "./core/recorder-controller"
import type { CreateRecorderOptions } from "./types"

export type {
  AudioCaptureOptions,
  AudioChannelCount,
  AudioFrame,
  CreateRecorderOptions,
  RecorderErrorEvent,
  RecorderEventMap,
  RecorderFrameEvent,
  RecorderOpenOptions,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
  RecorderStateChangeEvent,
  RecorderWarning,
  RecorderWarningEvent,
} from "./types"

export {
  RecorderInputSource,
  RecorderState,
  RecorderWarningCode,
} from "./types"

export { RecorderController } from "./core/recorder-controller"

export function createRecorder(
  options: CreateRecorderOptions = {}
): RecorderController {
  return new RecorderController({
    captureAdapter: options.captureAdapter ?? new BrowserCaptureAdapter(),
  })
}
