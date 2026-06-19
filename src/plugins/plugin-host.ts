import type { RecorderController } from "@/core/recorder-controller"
import { EventBus } from "@/core/event-bus"
import {
  PluginEventBus,
  type PluginEventMap,
  type PluginEventBusContext,
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

interface PluginHostOptions {
  recorder: RecorderController
  emitIssue: (issue: RecorderIssue) => void
  getRuntimeInfo: () => RecorderRuntimeInfo
  getLatestSummary: () => RecorderSessionSummary
  createEventContext: () => PluginEventBusContext
}

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
