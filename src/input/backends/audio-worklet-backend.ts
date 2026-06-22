import {
  type InputBackend,
  type InputBackendContext,
  InputBackendUnavailableError,
} from "@/input/backends/types"
import { resolveChannelCount } from "@/utils/audio-frame"

const RECORDER_WORKLET_PROCESSOR_NAME = "audio-recorder-frame-processor"

type AudioWorkletProcessorMessage =
  | {
      type: "frame"
      planar: Float32Array[]
      channelCount: number
    }
  | {
      type: "worklet-error"
      message: string
    }

type AudioWorkletNodeConstructor = {
  new (
    context: BaseAudioContext,
    name: string,
    options?: AudioWorkletNodeOptions
  ): AudioWorkletNode
}

/**
 * AudioWorklet processor 源码。桌面端逐 quantum 直发；移动端累积到
 * batchSamples（约 60Hz）才发一次，降低主线程消息频率。
 */
function createWorkletModuleSource(): string {
  return `
class AudioRecorderFrameProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options)
    this._batchSamples = (options.processorOptions && options.processorOptions.batchSamples) || 0
    this._buffer = []
    this._bufferedSamples = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) {
      return true
    }

    const frameLength = input[0] ? input[0].length : 0
    if (frameLength === 0) {
      return true
    }

    if (this._batchSamples <= 0) {
      const planar = input.map((channel) => new Float32Array(channel))
      this.port.postMessage({ type: "frame", planar, channelCount: input.length })
      return true
    }

    this._buffer.push(input.map((channel) => new Float32Array(channel)))
    this._bufferedSamples += frameLength

    if (this._bufferedSamples >= this._batchSamples) {
      const channelCount = this._buffer[0].length
      const merged = []
      for (let ch = 0; ch < channelCount; ch++) {
        const combined = new Float32Array(this._bufferedSamples)
        let offset = 0
        for (const frame of this._buffer) {
          combined.set(frame[ch], offset)
          offset += frame[ch].length
        }
        merged.push(combined)
      }
      this.port.postMessage({ type: "frame", planar: merged, channelCount })
      this._buffer = []
      this._bufferedSamples = 0
    }

    return true
  }
}

registerProcessor("${RECORDER_WORKLET_PROCESSOR_NAME}", AudioRecorderFrameProcessor)
`
}

// WeakMap 缓存已注册的 AudioWorklet，避免污染 audioWorklet 对象属性、同一 context 不重复注册
const registeredWorklets = new WeakMap<AudioWorklet, boolean>()

async function ensureWorkletRegistered(
  audioContext: AudioContext
): Promise<void> {
  const audioWorklet = (
    audioContext as AudioContext & { audioWorklet?: AudioWorklet }
  ).audioWorklet

  if (!audioWorklet) {
    throw new Error(
      "AudioWorklet is not available in the current AudioContext."
    )
  }

  if (registeredWorklets.get(audioWorklet)) {
    return
  }

  const moduleBlob = new Blob([createWorkletModuleSource()], {
    type: "application/javascript",
  })
  const moduleUrl = URL.createObjectURL(moduleBlob)
  try {
    await audioWorklet.addModule(moduleUrl)
    registeredWorklets.set(audioWorklet, true)
  } finally {
    URL.revokeObjectURL(moduleUrl)
  }
}

function getAudioWorkletNodeConstructor():
  | AudioWorkletNodeConstructor
  | undefined {
  return (
    globalThis as typeof globalThis & {
      AudioWorkletNode?: AudioWorkletNodeConstructor
    }
  ).AudioWorkletNode
}

/**
 * AudioWorklet 采集 backend。图拓扑：
 *   source → workletNode → sinkGain(0) → destination
 * 原生 APM 已在 track 上生效。AudioWorkletNode 不存在或注册失败时抛
 * InputBackendUnavailableError，触发降级到 ScriptProcessor。
 */
export async function createAudioWorkletBackend(
  context: InputBackendContext
): Promise<InputBackend> {
  const { audioContext, stream, channelCount, sink, emitIssue } = context

  const WorkletNodeCtor = getAudioWorkletNodeConstructor()
  if (!WorkletNodeCtor) {
    throw new InputBackendUnavailableError(
      "audio-worklet",
      "AudioWorkletNode is not supported in this browser."
    )
  }

  try {
    await ensureWorkletRegistered(audioContext)
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "unknown AudioWorklet error"
    throw new InputBackendUnavailableError(
      "audio-worklet",
      `AudioWorklet registration failed. ${reason}`
    )
  }

  // 仅移动端启用帧缓冲，目标约 60Hz
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  const batchSamples = isMobile ? Math.round(audioContext.sampleRate / 60) : 0

  let workletNode: AudioWorkletNode
  try {
    workletNode = new WorkletNodeCtor(
      audioContext,
      RECORDER_WORKLET_PROCESSOR_NAME,
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        // clamped-max：节点声道数 = min(channelCount, 上游 source 实际声道数)。
        // channelCount 取 track.getSettings() 解析出的实际硬件声道数（非用户请求值），
        // 但即便它偏大（如 getSettings 未上报时回退到请求值 2、而硬件实际单声道），
        // clamped-max 也只会向下钳到真实声道数，绝不向上补出假声道（避免假立体声）。
        // process() 拿到的 input 声道数即真实值，原样回传，与上报的 actualChannelCount 一致。
        channelCount,
        channelCountMode: "clamped-max",
        processorOptions: { batchSamples },
      }
    )
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "unknown AudioWorklet error"
    throw new InputBackendUnavailableError(
      "audio-worklet",
      `AudioWorkletNode construction failed. ${reason}`
    )
  }

  workletNode.port.onmessage = (
    event: MessageEvent<AudioWorkletProcessorMessage>
  ) => {
    const payload = event.data
    if (payload.type === "worklet-error") {
      emitIssue({ kind: "error", error: new Error(payload.message) })
      return
    }
    if (payload.type === "frame") {
      const planar = payload.planar.slice(
        0,
        resolveChannelCount(payload.channelCount)
      )
      sink.acceptFrame(planar, performance.now())
    }
  }

  const sourceNode = audioContext.createMediaStreamSource(stream)
  const sinkNode = audioContext.createGain()
  sinkNode.gain.value = 0
  sourceNode.connect(workletNode)
  workletNode.connect(sinkNode)
  sinkNode.connect(audioContext.destination)

  return {
    strategy: "audio-worklet",
    // worklet 持续产帧，暂停/恢复由 session 的状态门控负责
    suspend: () => {},
    resume: () => {},
    dispose: () => {
      workletNode.port.onmessage = null
      safeDisconnect(sourceNode)
      safeDisconnect(workletNode)
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
