import type { RecorderController } from "@/core/recorder-controller"
import { EventBus } from "@/core/event-bus"
import {
  PluginEventBus,
  type PluginEventBusContext,
  type PluginEventMap,
} from "@/plugins/plugin-event-bus"
import type {
  RecorderPlugin,
  RecorderPluginContext,
  RecorderPluginEventContext,
  RecorderPluginEventPayload,
} from "@/plugins/types"
import type {
  AudioFrame,
  RecorderIssue,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
} from "@/types"

/** PluginHost 的构造选项，由 RecorderController 注入。 */
interface PluginHostOptions {
  /** 录音控制器实例，透传给每个插件的 context。 */
  recorder: RecorderController
  /** 向外发布录音异常（插件 setup/hook/dispose 抛出时使用）。 */
  emitIssue: (issue: RecorderIssue) => void
  /** 获取当前录音运行时信息（时长、采样率等）。 */
  getRuntimeInfo: () => RecorderRuntimeInfo
  /** 获取最近一次录音导出摘要，供插件事件上下文使用。 */
  getLatestSummary: () => RecorderSessionSummary
  /** 每次插件 emit 时调用，生成注入事件对象的上下文快照。 */
  createEventContext: () => PluginEventBusContext
}

/**
 * 插件宿主，管理所有已注册插件的生命周期与钩子分发。
 *
 * 职责：
 * - 维护插件列表，保证名称唯一；
 * - 在 setup/dispose 失败时捕获错误并转为 RecorderIssue；
 * - 将录音生命周期事件（onStart/onFrame/onPause/onResume/onStop）广播给所有插件；
 * - 为每个插件创建隔离的 PluginEventBus，防止事件名冲突。
 */
export class PluginHost {
  private readonly plugins: RecorderPlugin[] = []
  private readonly pluginEventBus = new EventBus<PluginEventMap>()
  private readonly hookDispatch: Record<
    "onFrame" | "onStart" | "onPause" | "onResume" | "onStop",
    (plugin: RecorderPlugin, frame?: AudioFrame) => void
  > = {
    onFrame: (plugin, frame) => plugin.onFrame?.(frame as AudioFrame),
    onStart: (plugin) => plugin.onStart?.(),
    onPause: (plugin) => plugin.onPause?.(),
    onResume: (plugin) => plugin.onResume?.(),
    onStop: (plugin) => plugin.onStop?.(),
  }

  constructor(private readonly options: PluginHostOptions) {}

  on(
    event: string,
    listener: (
      payload: RecorderPluginEventContext<RecorderPluginEventPayload>
    ) => void
  ): () => void {
    return this.pluginEventBus.on(event, listener)
  }

  off(
    event: string,
    listener: (
      payload: RecorderPluginEventContext<RecorderPluginEventPayload>
    ) => void
  ): void {
    this.pluginEventBus.off(event, listener)
  }

  async use(plugin: RecorderPlugin): Promise<void> {
    if (this.plugins.some((item) => item.name === plugin.name)) {
      throw new Error(`Recorder plugin "${plugin.name}" is already registered.`)
    }

    try {
      await plugin.setup(this.createPluginContext(plugin.name))
      this.plugins.push(plugin)
    } catch (error) {
      const pluginError = this.createPluginError(plugin.name, "setup", error)
      this.options.emitIssue({
        kind: "error",
        error: pluginError,
      })
      throw pluginError
    }
  }

  onStart(): void {
    this.runHook("onStart")
  }

  onFrame(frame: AudioFrame): void {
    this.runHook("onFrame", frame)
  }

  onPause(): void {
    this.runHook("onPause")
  }

  onResume(): void {
    this.runHook("onResume")
  }

  onStop(): void {
    this.runHook("onStop")
  }

  async destroy(): Promise<void> {
    const plugins = [...this.plugins].reverse()
    this.plugins.length = 0
    this.pluginEventBus.clear()

    for (const plugin of plugins) {
      if (!plugin.dispose) {
        continue
      }

      try {
        await plugin.dispose()
      } catch (error) {
        this.options.emitIssue({
          kind: "error",
          error: this.createPluginError(plugin.name, "dispose", error),
        })
      }
    }
  }

  private createPluginContext(pluginName: string): RecorderPluginContext {
    return {
      recorder: this.options.recorder,
      getRuntimeInfo: () => this.options.getRuntimeInfo(),
      getLatestSummary: () => this.options.getLatestSummary(),
      eventBus: new PluginEventBus(
        pluginName,
        this.pluginEventBus,
        this.options.createEventContext
      ),
    }
  }

  private runHook(hookName: "onFrame", frame: AudioFrame): void
  private runHook(hookName: "onStart" | "onPause" | "onResume" | "onStop"): void
  private runHook(
    hookName: "onFrame" | "onStart" | "onPause" | "onResume" | "onStop",
    frame?: AudioFrame
  ): void {
    const dispatch = this.hookDispatch[hookName]
    for (const plugin of this.plugins) {
      try {
        dispatch(plugin, frame)
      } catch (error) {
        this.options.emitIssue({
          kind: "error",
          error: this.createPluginError(plugin.name, hookName, error),
        })
      }
    }
  }

  private createPluginError(
    pluginName: string,
    stage: string,
    error: unknown
  ): Error {
    const message = `Recorder plugin "${pluginName}" failed during ${stage}.`

    if (error instanceof Error) {
      return new Error(message, {
        cause: error,
      })
    }

    return new Error(message)
  }
}
