import { type InputBackend, type InputBackendContext } from "./types"
import { resolveChannelCount } from "../../utils/audio-frame"

/**
 * ScriptProcessor 采集 backend —— 最低优先级的降级兜底。
 *
 * ScriptProcessor 已废弃，仅在 AudioWorklet 不可用时使用。图拓扑：
 *   source → scriptProcessor → sinkGain(0) → destination
 * sinkGain(0) 仅为接到 destination 防止部分浏览器暂停回调，不产生可听输出。
 *
 * 原生 APM（AEC/NS/AGC）已在 getUserMedia 的 track 上生效，此处不做额外处理。
 */
export async function createScriptProcessorBackend(
  context: InputBackendContext
): Promise<InputBackend> {
  const { audioContext, stream, channelCount, sink } = context

  // ScriptProcessor is deprecated and kept strictly as the runtime fallback path.
  const scriptProcessorNode = audioContext.createScriptProcessor(
    4096,
    channelCount,
    channelCount
  )

  scriptProcessorNode.onaudioprocess = (event) => {
    const actualChannelCount = resolveChannelCount(
      event.inputBuffer.numberOfChannels
    )
    const planar = Array.from(
      { length: actualChannelCount },
      (_, channelIndex) => event.inputBuffer.getChannelData(channelIndex)
    )
    sink.acceptFrame(planar, performance.now())
  }

  const sourceNode = audioContext.createMediaStreamSource(stream)
  const sinkNode = audioContext.createGain()
  sinkNode.gain.value = 0
  sourceNode.connect(scriptProcessorNode)
  scriptProcessorNode.connect(sinkNode)
  sinkNode.connect(audioContext.destination)

  return {
    strategy: "script-processor",
    // ScriptProcessor 持续产帧，暂停/恢复由 session 的状态门控负责
    suspend: () => {},
    resume: () => {},
    dispose: () => {
      scriptProcessorNode.onaudioprocess = null
      safeDisconnect(sourceNode)
      safeDisconnect(scriptProcessorNode)
      safeDisconnect(sinkNode)
    },
  }
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect()
  } catch {
    /* ignore */
  }
}
