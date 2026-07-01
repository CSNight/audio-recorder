import { EventBus } from "@/core/event-bus"
import type {
  RecorderPluginEventBus,
  RecorderPluginEventContext,
  RecorderPluginEventMap,
} from "@/plugins/types"
import type { RecorderEventContext } from "@/types"

/**
 * 核心内置事件名，插件不得注册同名事件，避免与主事件总线产生命名冲突。
 */
const RESERVED_EVENT_NAMES = new Set([
  "statechange",
  "frame",
  "frame:async",
  "issue",
])

/**
 * 单个插件的事件总线隔离层。
 *
 * 插件只能发布自己预先 register() 过的事件，且事件名不得与核心保留名冲突。
 * emit 时自动将当前录音上下文快照注入事件对象，监听方无需额外查询控制器。
 */
export class PluginEventBus implements RecorderPluginEventBus {
  private readonly registeredEvents = new Set<string>()

  constructor(
    private readonly pluginName: string,
    private readonly eventBus: EventBus<RecorderPluginEventMap>,
    private readonly createContext: () => RecorderEventContext
  ) {}

  /** 注册一个插件自定义事件名；必须在 emit 前调用，否则 emit 抛错。 */
  register(event: string): void {
    this.assertRegistrableEvent(event)
    this.registeredEvents.add(event)
  }

  /** 发布已注册的插件事件，自动附加录音上下文快照。 */
  emit<TPayload extends object>(event: string, payload: TPayload): void {
    this.assertRegisteredEvent(event)

    const pluginEvent: RecorderPluginEventContext<TPayload> = {
      pluginName: this.pluginName,
      payload,
      ...this.createContext(),
    }

    this.eventBus.emit(
      event,
      pluginEvent as unknown as RecorderPluginEventContext
    )
  }

  /** 校验事件名是否可注册：以 "plugin:" 前缀开头的名称允许通过，保留名直接报错。 */
  private assertRegistrableEvent(event: string): void {
    if (event.startsWith("plugin:")) {
      return
    }
    if (RESERVED_EVENT_NAMES.has(event)) {
      throw new Error(
        `Recorder plugin event "${event}" is reserved for the core event bus.`
      )
    }
  }

  /** 校验事件名是否已注册，未注册时 emit 抛出明确错误，防止拼写错误静默失效。 */
  private assertRegisteredEvent(event: string): void {
    this.assertRegistrableEvent(event)

    if (!this.registeredEvents.has(event)) {
      throw new Error(
        `Recorder plugin event "${event}" must be registered before emit.`
      )
    }
  }
}
