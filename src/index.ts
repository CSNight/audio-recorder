/**
 * 库的主入口：导出公共 API（createRecorder / RecorderController / 类型定义等）。
 * 各编码格式（mp3 / aac / amr / flac / g711 / opus）作为独立子入口，
 * 按需从 "@csnight/audio-recorder/codecs/xxx" 单独导入，避免主包体积膨胀。
 */
import {
  BrowserInputAdapter,
  listMicrophoneDevices,
} from "./input/browser-input-adapter"
import { RecorderController } from "./core/recorder-controller"
import type { CreateRecorderOptions } from "./types"

export { listMicrophoneDevices }
export {
  checkRecorderCapability,
  type RecorderCapabilityReport,
} from "./input/capability-check"

export { RecorderController } from "./core/recorder-controller"
export type { ExportEncoderDefinition, EncoderMap } from "./types"

export type {
  RecorderPersistencePlugin,
  RecorderPersistenceSession,
  RecorderPersistenceSessionOptions,
  RecorderStorageOptions,
} from "./storage/types"
export type {
  AudioFrame,
  AudioInputDevice,
  CreateRecorderOptions,
  RecorderEventMap,
  RecorderFrameEvent,
  RecorderInputOptions,
  RecorderInputStrategy,
  RecorderIssue,
  RecorderIssueEvent,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
  RecorderStateChangeEvent,
  RecorderWarning,
} from "./types"
export {
  RecorderInputSource,
  RecorderState,
  RecorderWarningCode,
} from "./types"
export { resample } from "./utils/resample"
export {
  serializePcmSnapshot,
  deserializePcmSnapshot,
} from "./utils/snapshot-codec"

export function createRecorder(
  options: CreateRecorderOptions = {}
): RecorderController {
  const { storage, encoders, ...inputOptions } = options
  return new RecorderController({
    inputAdapter: new BrowserInputAdapter(),
    storageOptions: storage ?? undefined,
    defaultInput: inputOptions,
    encoders: encoders ?? [],
  })
}
