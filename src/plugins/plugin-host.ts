import type { RecorderController } from "../core/recorder-controller"
import { EventBus } from "../core/event-bus"
import { PluginEventBus } from "./plugin-event-bus"
import type {
  RecorderPlugin,
  RecorderPluginContext,
  RecorderPluginEventContext,
  RecorderPluginEventMap,
} from "./types"
import type {
  AudioFrame,
  RecorderEventContext,
  RecorderIssue,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
} from "../types"
import { cloneAudioFrame } from "../utils/audio-frame"

const MAX_FLUSH_ROUNDS = 16

interface ExpectedFlushFormat {
  sampleRate: number
  channels: number
  frameLength?: number
}

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
  createEventContext: () => RecorderEventContext
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
  private readonly pluginEventBus = new EventBus<RecorderPluginEventMap>()
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
    listener: (payload: RecorderPluginEventContext) => void
  ): () => void {
    return this.pluginEventBus.on(event, listener)
  }

  off(
    event: string,
    listener: (payload: RecorderPluginEventContext) => void
  ): void {
    this.pluginEventBus.off(event, listener)
  }

  async use(plugin: RecorderPlugin): Promise<void> {
    if (this.plugins.some((item) => item.name === plugin.name)) {
      throw new Error(`Recorder plugin "${plugin.name}" is already registered.`)
    }

    this.assertExclusiveCompatibility(plugin)

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

  async unuse(name: string): Promise<void> {
    const matchedPlugins = this.collectMatchedPlugins(name)
    if (matchedPlugins.length === 0) {
      throw new Error(`Recorder plugin "${name}" is not registered.`)
    }
    const matchedPluginSet = new Set(matchedPlugins)

    this.plugins.splice(
      0,
      this.plugins.length,
      ...this.plugins.filter((plugin) => !matchedPluginSet.has(plugin))
    )

    for (const plugin of [...matchedPlugins].reverse()) {
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

  onStart(): void {
    this.runHook("onStart")
  }

  processBeforeFrame(frame: AudioFrame, startIndex = 0): AudioFrame {
    // 延迟克隆：仅在遇到第一个 onBeforeFrame 插件时才克隆，避免无插件时的冗余拷贝。
    let currentFrame: AudioFrame | undefined

    for (
      let pluginIndex = startIndex;
      pluginIndex < this.plugins.length;
      pluginIndex += 1
    ) {
      const plugin = this.plugins[pluginIndex]
      if (!plugin?.onBeforeFrame) {
        continue
      }

      // 首次进入处理链时，对原始帧做一次深拷贝，使插件可安全地就地修改 planar buffer。
      if (!currentFrame) {
        currentFrame = cloneAudioFrame(frame)
      }

      const fallbackFrame = cloneAudioFrame(currentFrame)

      try {
        const nextFrame = plugin.onBeforeFrame(currentFrame) ?? currentFrame
        currentFrame = this.normalizeFrame(
          plugin.name,
          nextFrame,
          currentFrame,
          {
            sampleRate: fallbackFrame.sampleRate,
            channels: fallbackFrame.channels,
            frameLength: fallbackFrame.planar[0]?.length ?? 0,
          }
        )
      } catch (error) {
        currentFrame = fallbackFrame
        this.options.emitIssue({
          kind: "error",
          error: this.createPluginError(plugin.name, "onBeforeFrame", error),
        })
      }
    }

    return currentFrame ?? frame
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

  flushDspFrames(expectedFormat?: ExpectedFlushFormat): AudioFrame[] {
    const flushedFrames: AudioFrame[] = []
    let roundCount = 0

    while (roundCount < MAX_FLUSH_ROUNDS) {
      let producedFrames = false

      for (
        let pluginIndex = 0;
        pluginIndex < this.plugins.length;
        pluginIndex += 1
      ) {
        const plugin = this.plugins[pluginIndex]
        if (!plugin?.onFlush) {
          continue
        }

        try {
          const frames = plugin.onFlush()
          if (!frames || frames.length === 0) {
            continue
          }

          producedFrames = true

          for (const frame of frames) {
            const normalizedFrame = this.normalizeFrame(
              plugin.name,
              frame,
              undefined,
              expectedFormat
            )
            flushedFrames.push(
              this.processBeforeFrame(normalizedFrame, pluginIndex + 1)
            )
          }
        } catch (error) {
          this.options.emitIssue({
            kind: "error",
            error: this.createPluginError(plugin.name, "onFlush", error),
          })
        }
      }

      if (!producedFrames) {
        return flushedFrames
      }

      roundCount += 1
    }

    this.options.emitIssue({
      kind: "error",
      error: new Error(
        `Recorder plugin flush drain exceeded ${MAX_FLUSH_ROUNDS} rounds and was stopped early.`
      ),
    })

    return flushedFrames
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

  private collectMatchedPlugins(name: string): RecorderPlugin[] {
    return this.plugins.filter((plugin) =>
      this.matchesRequestedName(name, plugin.name)
    )
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

  /**
   * 统一校验插件产出的帧，并按主链路约束归一化：
   * - onBeforeFrame 必须保持输入帧的格式与长度；
   * - onFlush 必须保持当前录音会话的采样率/声道数；
   * - 若插件原地修改并返回同一对象，则直接复用该对象，仅回填受保护元数据。
   */
  private normalizeFrame(
    pluginName: string,
    frame: AudioFrame,
    currentFrame?: AudioFrame,
    expectedFormat?: ExpectedFlushFormat
  ): AudioFrame {
    const frameLength = this.assertFrameShape(pluginName, frame)

    if (expectedFormat) {
      if (frame.sampleRate !== expectedFormat.sampleRate) {
        throw new Error(
          `Recorder plugin "${pluginName}" must preserve frame.sampleRate.`
        )
      }
      if (frame.channels !== expectedFormat.channels) {
        throw new Error(
          `Recorder plugin "${pluginName}" must preserve frame.channels.`
        )
      }
      if (
        expectedFormat.frameLength !== undefined &&
        frameLength !== expectedFormat.frameLength
      ) {
        throw new Error(
          `Recorder plugin "${pluginName}" must preserve per-channel frame length.`
        )
      }
    }

    if (currentFrame && frame === currentFrame) {
      frame.channels = expectedFormat?.channels ?? frame.channels
      frame.sampleRate = expectedFormat?.sampleRate ?? frame.sampleRate
      frame.timestamp = currentFrame.timestamp
      frame.durationMs = currentFrame.durationMs
      return frame
    }

    return {
      channels: expectedFormat?.channels ?? frame.channels,
      sampleRate: expectedFormat?.sampleRate ?? frame.sampleRate,
      timestamp: currentFrame?.timestamp ?? frame.timestamp,
      durationMs:
        currentFrame?.durationMs ??
        (frameLength === 0 ? 0 : (frameLength / frame.sampleRate) * 1000),
      planar: frame.planar.map((channel) => new Int16Array(channel)),
    }
  }

  private assertFrameShape(pluginName: string, frame: AudioFrame): number {
    if (!Number.isFinite(frame.sampleRate) || frame.sampleRate <= 0) {
      throw new Error(
        `Recorder plugin "${pluginName}" produced an invalid frame.sampleRate.`
      )
    }
    if (!Number.isFinite(frame.timestamp)) {
      throw new Error(
        `Recorder plugin "${pluginName}" produced an invalid frame.timestamp.`
      )
    }
    if (
      !Number.isInteger(frame.channels) ||
      frame.channels < 1 ||
      frame.planar.length !== frame.channels
    ) {
      throw new Error(
        `Recorder plugin "${pluginName}" produced an invalid frame.channels/planar shape.`
      )
    }

    const frameLength = frame.planar[0]?.length ?? 0
    for (
      let channelIndex = 0;
      channelIndex < frame.channels;
      channelIndex += 1
    ) {
      if ((frame.planar[channelIndex]?.length ?? 0) !== frameLength) {
        throw new Error(
          `Recorder plugin "${pluginName}" produced mismatched channel lengths.`
        )
      }
    }

    return frameLength
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

  private assertExclusiveCompatibility(nextPlugin: RecorderPlugin): void {
    for (const registeredPlugin of this.plugins) {
      if (
        this.matchesExclusiveWith(nextPlugin, registeredPlugin.name) ||
        this.matchesExclusiveWith(registeredPlugin, nextPlugin.name)
      ) {
        throw new Error(
          `Recorder plugin "${nextPlugin.name}" conflicts with "${registeredPlugin.name}".`
        )
      }
    }
  }

  private matchesExclusiveWith(
    plugin: RecorderPlugin,
    targetName: string
  ): boolean {
    return (
      plugin.exclusiveWith?.some((prefix) =>
        this.matchesPluginPrefix(prefix, targetName)
      ) ?? false
    )
  }

  private matchesPluginPrefix(prefix: string, pluginName: string): boolean {
    return pluginName === prefix || pluginName.startsWith(`${prefix}:`)
  }

  private matchesRequestedName(
    requestedName: string,
    pluginName: string
  ): boolean {
    if (requestedName.includes(":")) {
      return pluginName === requestedName
    }

    return this.matchesPluginPrefix(requestedName, pluginName)
  }
}
