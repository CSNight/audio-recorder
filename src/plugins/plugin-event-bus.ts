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
    this.assertRegistrableEvent(event)

    // 事件名先登记再允许 emit，避免插件在运行时随意扩散未声明事件。
    this.registeredEvents.add(event)
  }

  emit<TPayload extends RecorderPluginEventPayload>(
    event: string,
    payload: TPayload
  ): void {
    this.assertRegisteredEvent(event)

    // 插件事件统一补齐宿主上下文，外部监听方不需要自行拼接会话信息。
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

  private assertRegistrableEvent(event: string): void {
    // 核心事件名保留给控制器，避免插件伪造 frame/statechange/issue。
    if (RESERVED_EVENT_NAMES.has(event)) {
      throw new Error(
        `Recorder plugin event "${event}" is reserved for the core event bus.`
      )
    }
  }

  private assertRegisteredEvent(event: string): void {
    this.assertRegistrableEvent(event)

    if (!this.registeredEvents.has(event)) {
      throw new Error(
        `Recorder plugin event "${event}" must be registered before emit.`
      )
    }
  }
}
