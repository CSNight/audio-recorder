import { EventBus } from "@/core/event-bus"
import type {
  RecorderPluginEventBus,
  RecorderPluginEventContext,
  RecorderPluginEventPayload,
} from "@/plugins/types"
import type {
  RecorderEventMap,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
} from "@/types"

export interface PluginEventBusContext {
  controller: import("@/core/recorder-controller").RecorderController
  sessionId: string
  emittedAt: number
  runtimeInfo: RecorderRuntimeInfo
  summary: RecorderSessionSummary
}

const RESERVED_EVENT_NAMES = new Set(["statechange", "frame", "issue"])

export class PluginEventBus implements RecorderPluginEventBus {
  private readonly registeredEvents = new Set<string>()

  constructor(
    private readonly pluginName: string,
    private readonly eventBus: EventBus<RecorderEventMap>,
    private readonly createContext: () => PluginEventBusContext
  ) {}

  register(event: string): void {
    if (RESERVED_EVENT_NAMES.has(event)) {
      throw new Error(
        `Recorder plugin event "${event}" is reserved for the core event bus.`
      )
    }

    this.registeredEvents.add(event)
  }

  emit<TPayload extends RecorderPluginEventPayload>(
    event: string,
    payload: TPayload
  ): void {
    if (!this.registeredEvents.has(event)) {
      throw new Error(
        `Recorder plugin event "${event}" must be registered before emit.`
      )
    }

    const pluginEvent: RecorderPluginEventContext<TPayload> = {
      pluginName: this.pluginName,
      payload,
      ...this.createContext(),
    }

    this.eventBus.emit(
      event as keyof RecorderEventMap,
      pluginEvent as unknown as RecorderEventMap[keyof RecorderEventMap]
    )
  }
}
