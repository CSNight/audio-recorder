import {
  BrowserInputAdapter,
  listMicrophoneDevices,
} from "@/input/browser-input-adapter"
import { RecorderController } from "@/core/recorder-controller"
import type { CreateRecorderOptions } from "@/types"

export { listMicrophoneDevices }
export {
  checkRecorderCapability,
  type RecorderCapabilityReport,
} from "@/input/capability-check"

export { RecorderController } from "@/core/recorder-controller"
export type { SnapshotEncoderDefinition, EncoderMap } from "@/types"

export type {
  RecorderPersistencePlugin,
  RecorderPersistenceSession,
  RecorderPersistenceSessionOptions,
  RecorderStorageOptions,
} from "@/storage/types"
export type {
  AudioChannelCount,
  AudioFrame,
  AudioInputDevice,
  CreateRecorderOptions,
  RecorderEventMap,
  RecorderFrameEvent,
  RecorderInputOptions,
  RecorderInputStrategy,
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
export { resample } from "@/utils/resample"
export {
  serializePcmSnapshot,
  deserializePcmSnapshot,
} from "@/utils/snapshot-codec"

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
