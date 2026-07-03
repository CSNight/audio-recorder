import { createAudioWorkletBackend } from "./audio-worklet-backend"
import { createMediaRecorderBackend } from "./media-recorder-backend"
import { createScriptProcessorBackend } from "./script-processor-backend"
import {
  type InputBackend,
  type InputBackendContext,
  type InputBackendFactory,
  InputBackendUnavailableError,
} from "./types"
import { type RecorderInputStrategy, RecorderWarningCode } from "../../types"

const FACTORIES: Record<RecorderInputStrategy, InputBackendFactory> = {
  "media-recorder": createMediaRecorderBackend,
  "audio-worklet": createAudioWorkletBackend,
  "script-processor": createScriptProcessorBackend,
}

// 标准优先级：MediaRecorder → AudioWorklet → ScriptProcessor
const STANDARD_ORDER: RecorderInputStrategy[] = [
  "media-recorder",
  "audio-worklet",
  "script-processor",
]

// 某个 backend 降级时使用的告警码
const FALLBACK_WARNING: Record<RecorderInputStrategy, RecorderWarningCode> = {
  "media-recorder": RecorderWarningCode.MediaRecorderFallback,
  "audio-worklet": RecorderWarningCode.ScriptProcessorFallback,
  "script-processor": RecorderWarningCode.ScriptProcessorFallback,
}

/**
 * 构造候选链路顺序：
 *  - "auto"  → 标准优先级
 *  - 显式值  → 该模式优先，其后接标准链路其余项（保证显式不可用时仍能降级）
 */
function buildCandidateOrder(
  requested: "auto" | RecorderInputStrategy
): RecorderInputStrategy[] {
  if (requested === "auto") {
    return STANDARD_ORDER
  }
  return [requested, ...STANDARD_ORDER.filter((s) => s !== requested)]
}

/**
 * 按候选顺序逐个尝试建立 InputBackend，返回首个成功者。
 *
 * 每个 backend 不可用（抛 InputBackendUnavailableError）时发一条降级 warning 后
 * 尝试下一个；返回的 backend.strategy 即实际采集链路。全部失败则抛最后一个错误。
 */
export async function selectInputBackend(options: {
  requested: "auto" | RecorderInputStrategy
  context: InputBackendContext
}): Promise<InputBackend> {
  const { requested, context } = options
  const order = buildCandidateOrder(requested)

  let lastError: unknown
  for (let i = 0; i < order.length; i++) {
    const strategy = order[i]!
    try {
      return await FACTORIES[strategy](context)
    } catch (error) {
      lastError = error
      const isLast = i === order.length - 1
      const reason =
        error instanceof InputBackendUnavailableError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error)
      // 最后一个候选失败不再发"降级"warning（无处可降），错误会向上抛出
      if (!isLast) {
        context.emitIssue({
          kind: "warning",
          warning: {
            code: FALLBACK_WARNING[strategy],
            message: `Input strategy "${strategy}" unavailable, falling back to "${order[i + 1]}". ${reason}`,
          },
        })
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("No input backend could be established.")
}
