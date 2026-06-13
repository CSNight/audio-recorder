import type { CaptureHandlers } from "@/capture/types"
import type { AudioChannelCount } from "@/types"
import { RecorderWarningCode } from "@/types"
import { resolveChannelCount } from "@/utils/audio-frame"

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

type AudioWorkletProcessorConstructor = {
  new (
    context: BaseAudioContext,
    name: string,
    options?: AudioWorkletNodeOptions
  ): AudioWorkletNode
}

const RECORDER_WORKLET_PROCESSOR_NAME = "audio-recorder-frame-processor"

interface CaptureGraphSessionSink {
  acceptFrame: (planarFloat: readonly Float32Array[], timestamp: number) => void
}

export interface CaptureGraph {
  captureNode: AudioNode
  deactivateCaptureNode: () => void
  bindSession: (session: CaptureGraphSessionSink) => void
}

function createWorkletModuleSource(): string {
  return `
class AudioRecorderFrameProcessor extends AudioWorkletProcessor {
  process(inputs) {
    // Worklet 线程只负责搬运原始 float PCM，不在音频线程里做重 CPU 转换。
    const input = inputs[0]
    if (!input || input.length === 0) {
      return true
    }

    const frameLength = input[0]?.length ?? 0
    if (frameLength === 0) {
      return true
    }

    const planar = input.map((channel) => new Float32Array(channel))
    this.port.postMessage({
      type: "frame",
      planar,
      channelCount: input.length,
    })

    return true
  }
}

registerProcessor("${RECORDER_WORKLET_PROCESSOR_NAME}", AudioRecorderFrameProcessor)
`
}

async function ensureRecorderWorkletRegistered(
  audioContext: AudioContext
): Promise<void> {
  const recorderAudioContext = audioContext as AudioContext & {
    audioWorklet?: AudioWorklet
  }
  const audioWorklet = recorderAudioContext.audioWorklet

  if (!audioWorklet) {
    throw new Error(
      "AudioWorklet is not available in the current AudioContext."
    )
  }

  const registryKey = "__audioRecorderWorkletRegistered__"
  const workletRegistry = audioWorklet as AudioWorklet & {
    [registryKey]?: boolean
  }

  if (workletRegistry[registryKey]) {
    // 同一个 AudioContext 只注册一次 processor，避免重复 addModule。
    return
  }

  const moduleSource = createWorkletModuleSource()
  const moduleBlob = new Blob([moduleSource], {
    type: "application/javascript",
  })
  const moduleUrl = URL.createObjectURL(moduleBlob)

  try {
    await audioWorklet.addModule(moduleUrl)
    workletRegistry[registryKey] = true
  } finally {
    // addModule 完成后立刻释放 blob URL，避免诊断页反复打开时泄漏。
    URL.revokeObjectURL(moduleUrl)
  }
}

function getAudioWorkletNodeConstructor():
  | AudioWorkletProcessorConstructor
  | undefined {
  const scope = globalThis as typeof globalThis & {
    AudioWorkletNode?: AudioWorkletProcessorConstructor
  }

  return scope.AudioWorkletNode
}

function buildWarningMessage(error: unknown): string {
  const fallbackReason =
    error instanceof Error ? error.message : "unknown AudioWorklet error"

  return `AudioWorklet is unavailable, falling back to ScriptProcessor. ${fallbackReason}`
}

export async function createCaptureGraph(
  audioContext: AudioContext,
  requestedChannelCount: AudioChannelCount,
  handlers: CaptureHandlers
): Promise<CaptureGraph> {
  const workletNodeConstructor = getAudioWorkletNodeConstructor()
  if (workletNodeConstructor) {
    try {
      // 优先走 AudioWorklet，避免 ScriptProcessor 的兼容性和时序问题。
      await ensureRecorderWorkletRegistered(audioContext)

      let activeSession: CaptureGraphSessionSink | undefined
      const workletNode = new workletNodeConstructor(
        audioContext,
        RECORDER_WORKLET_PROCESSOR_NAME,
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: requestedChannelCount,
          channelCountMode: "explicit",
          outputChannelCount: [requestedChannelCount],
        }
      )

      workletNode.port.onmessage = (
        event: MessageEvent<AudioWorkletProcessorMessage>
      ) => {
        const payload = event.data
        if (!activeSession) {
          return
        }

        if (payload.type === "worklet-error") {
          handlers.onIssue({
            kind: "error",
            error: new Error(payload.message),
          })
          return
        }

        if (payload.type === "frame") {
          // Worklet 返回的声道数可能超出当前库支持范围，这里先收敛再交给 session。
          const planar = payload.planar.slice(
            0,
            resolveChannelCount(payload.channelCount)
          )
          activeSession.acceptFrame(planar, performance.now())
        }
      }

      return {
        captureNode: workletNode,
        deactivateCaptureNode: () => {
          workletNode.port.onmessage = null
        },
        bindSession: (session) => {
          activeSession = session
        },
      }
    } catch (error) {
      handlers.onIssue({
        kind: "warning",
        warning: {
          code: RecorderWarningCode.ScriptProcessorFallback,
          message: buildWarningMessage(error),
        },
      })
    }
  } else {
    handlers.onIssue({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.ScriptProcessorFallback,
        message:
          "AudioWorklet is unavailable, falling back to ScriptProcessor. AudioWorkletNode is not supported in this browser.",
      },
    })
  }

  let activeSession: CaptureGraphSessionSink | undefined
  // ScriptProcessor is deprecated and kept strictly as the runtime fallback path.
  const scriptProcessorNode = audioContext.createScriptProcessor(
    4096,
    requestedChannelCount,
    requestedChannelCount
  )

  scriptProcessorNode.onaudioprocess = (event) => {
    if (!activeSession) {
      return
    }

    // ScriptProcessor 直接从 AudioBuffer 逐声道读取 float 数据，再复用同一套 frame 入口。
    const actualChannelCount = resolveChannelCount(
      event.inputBuffer.numberOfChannels
    )
    const planarFloat = Array.from(
      { length: actualChannelCount },
      (_, channelIndex) => event.inputBuffer.getChannelData(channelIndex)
    )

    activeSession.acceptFrame(planarFloat, performance.now())
  }

  return {
    captureNode: scriptProcessorNode,
    deactivateCaptureNode: () => {
      scriptProcessorNode.onaudioprocess = null
    },
    bindSession: (session) => {
      activeSession = session
    },
  }
}
