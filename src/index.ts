import { BrowserCaptureAdapter } from "@/capture/browser-capture-adapter"
export { exportPcmSnapshot } from "@/codecs/pcm/pcm-exporter"
export type { PcmExportOptions, PcmExportResult } from "@/codecs/pcm/types"
export { exportWavSnapshot } from "@/codecs/wav/wav-exporter"
export type { WavExportOptions, WavExportResult } from "@/codecs/wav/types"
import { RecorderController } from "@/core/recorder-controller"
export type { RecorderPlugin, RecorderPluginContext } from "@/plugins/types"
export type {
  RecorderPersistencePlugin,
  RecorderPersistenceSession,
  RecorderPersistenceSessionOptions,
  RecorderStorageOptions,
} from "@/storage/types"
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

export { RecorderController } from "@/core/recorder-controller"

export function createRecorder(
  options: CreateRecorderOptions = {}
): RecorderController {
  // 默认走浏览器采集适配器；测试或宿主接入时可注入自定义适配器替换底层采集实现。
  return new RecorderController({
    captureAdapter: options.captureAdapter ?? new BrowserCaptureAdapter(),
    storageOptions: options.storage ?? undefined,
  })
}
