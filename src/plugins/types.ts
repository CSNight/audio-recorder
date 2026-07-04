import type { RecorderController } from "../core/recorder-controller"
import type {
  AudioFrame,
  RecorderEventContext,
  RecorderRuntimeInfo,
  RecorderSessionSummary,
} from "../types"

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
  /**
   * 互斥插件名前缀列表。
   * 例如声明 ["streaming-export"] 时，会拦截 "streaming-export:wav" 这类同族插件。
   */
  exclusiveWith?: string[]
  setup(context: RecorderPluginContext): void | Promise<void>
  onStart?(): void
  /**
   * 主链路帧变换钩子。
   * 返回 void 表示透传输入帧；抛错时由宿主捕获并回退到进入该插件前的帧副本。
   *
   * 约束：宿主会强制保留输入帧的 timestamp、durationMs、channels、sampleRate 及每声道长度，
   * 插件返回帧中这些字段的修改会被忽略（planar 数据除外）。
   */
  onBeforeFrame?(frame: AudioFrame): AudioFrame | void
  onFrame?(frame: AudioFrame): void
  onPause?(): void
  onResume?(): void
  /**
   * stop 阶段的可选尾帧输出钩子。
   * 仅用于补出插件内部残余状态，不应阻塞 stop 主流程。
   */
  onFlush?(): AudioFrame[] | void
  onStop?(): void
  dispose?(): void | Promise<void>
}
