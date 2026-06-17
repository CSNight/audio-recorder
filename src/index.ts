import {
  BrowserCaptureAdapter,
  listMicrophoneDevices,
} from "@/capture/browser-capture-adapter"
import { RecorderController } from "@/core/recorder-controller"
import type { CreateRecorderOptions } from "@/types"

export { listMicrophoneDevices }

export { RecorderController } from "@/core/recorder-controller"
export {
  EncoderRegistry,
  createDefaultEncoderRegistry,
} from "@/encoders/encoder-registry"
export type { SnapshotEncoderDefinition } from "@/encoders/encoder-registry"
export type {
  RecorderPersistencePlugin,
  RecorderPersistenceSession,
  RecorderPersistenceSessionOptions,
  RecorderStorageOptions,
} from "@/storage/types"
export type {
  AudioCaptureOptions,
  AudioChannelCount,
  AudioFrame,
  AudioInputDevice,
  CreateRecorderOptions,
  RecorderEventMap,
  RecorderFrameEvent,
  RecorderIssue,
  RecorderIssueEvent,
  RecorderLevel,
  RecorderLevelChannel,
  RecorderLevelEvent,
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

export function createRecorder(
  options: CreateRecorderOptions = {}
): RecorderController {
  // 默认走浏览器采集适配器；测试或宿主接入时可注入自定义适配器替换底层采集实现。
  return new RecorderController({
    captureAdapter: options.captureAdapter ?? new BrowserCaptureAdapter(),
    storageOptions: options.storage ?? undefined,
  })
}
