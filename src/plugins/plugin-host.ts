import type { RecorderController } from "@/core/recorder-controller"
import { PluginEventBus } from "@/plugins/plugin-event-bus"
import type { RecorderPlugin, RecorderPluginContext } from "@/plugins/types"
import type {
  AudioFrame,
  RecorderIssue,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
} from "@/types"

interface PluginHostOptions {
  recorder: RecorderController
  emitIssue: (issue: RecorderIssue) => void
  eventBus: import("@/core/event-bus").EventBus<
    import("@/types").RecorderEventMap
  >
  getRuntimeInfo: () => RecorderRuntimeInfo
  getLatestSummary: () => RecorderSessionSummary
  createEventContext: () => {
    controller: RecorderController
    sessionId: string
    emittedAt: number
    runtimeInfo: RecorderRuntimeInfo
    summary: RecorderSessionSummary
  }
}

export class PluginHost {
  // 保持注册顺序，确保运行期 hook 派发顺序与宿主声明顺序一致。
  private readonly plugins: RecorderPlugin[] = []
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

  async use(plugin: RecorderPlugin): Promise<void> {
    if (this.plugins.some((item) => item.name === plugin.name)) {
      throw new Error(`Recorder plugin "${plugin.name}" is already registered.`)
    }

    try {
      // 只向插件暴露受限上下文，避免插件直接依赖控制器内部实现细节。
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
    // 逆序销毁与常见资源栈一致，后注册的插件通常依赖前面插件暴露的能力。
    const plugins = [...this.plugins].reverse()
    this.plugins.length = 0

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
      // 插件拿到的是受限事件门面，而不是核心 EventBus 实例本身。
      eventBus: new PluginEventBus(
        pluginName,
        this.options.eventBus,
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
        // 单个插件异常只通过 issue 上报，不中断其余插件，避免观察类插件互相拖垮。
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
