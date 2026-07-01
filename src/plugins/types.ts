import type { RecorderController } from "@/core/recorder-controller"
import type {
  AudioFrame,
  RecorderEventContext,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
} from "@/types"

export interface RecorderPluginEventContext<
  TPayload extends object = object,
> extends RecorderEventContext {
  pluginName: string
  payload: TPayload
}

export type RecorderPluginEventMap = Record<string, RecorderPluginEventContext>

export interface RecorderPluginEventBus {
  register(event: string): void
  emit<TPayload extends object>(event: string, payload: TPayload): void
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
