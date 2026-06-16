import type { RecorderController } from "@/core/recorder-controller"
import type {
  AudioFrame,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
} from "@/types"

export type RecorderPluginEventPayload = object

export interface RecorderPluginEventContext<TPayload> {
  controller: RecorderController
  sessionId: string
  emittedAt: number
  pluginName: string
  runtimeInfo: RecorderRuntimeInfo
  summary: RecorderSessionSummary
  payload: TPayload
}

export interface RecorderPluginEventBus {
  register(event: string): void
  emit<TPayload extends RecorderPluginEventPayload>(
    event: string,
    payload: TPayload
  ): void
}

export interface RecorderPluginContext {
  readonly recorder: RecorderController
  readonly eventBus: RecorderPluginEventBus

  getRuntimeInfo(): RecorderRuntimeInfo

  getLatestSummary(): RecorderSessionSummary
}

export interface RecorderPlugin {
  name: string
  setup(context: RecorderPluginContext): void | Promise<void>
  onStart?(): void
  onFrame?(frame: AudioFrame): void
  onPause?(): void
  onResume?(): void
  onStop?(): void
  dispose?(): void | Promise<void>
}
