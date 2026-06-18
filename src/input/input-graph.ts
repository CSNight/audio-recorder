import type { RecorderInputHandlers } from "@/input/types"
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

interface InputGraphSessionSink {
  acceptFrame: (planarFloat: readonly Float32Array[], timestamp: number) => void
}

export interface InputGraph {
  inputNode: AudioNode
  deactivateInputNode: () => void
  bindSession: (session: InputGraphSessionSink) => void
}

function createWorkletModuleSource(_batchSamples: number): string {
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
      // 桌面端：原有逐 quantum 直发
      const planar = input.map((channel) => new Float32Array(channel))
      this.port.postMessage({ type: "frame", planar, channelCount: input.length })
      return true
    }

    // 移动端：累积到 batchSamples 才发一次（约 60Hz）
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

async function ensureRecorderWorkletRegistered(
  audioContext: AudioContext,
  batchSamples: number
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
    return
  }

  const moduleSource = createWorkletModuleSource(batchSamples)
  const moduleBlob = new Blob([moduleSource], {
    type: "application/javascript",
  })
  const moduleUrl = URL.createObjectURL(moduleBlob)

  try {
    await audioWorklet.addModule(moduleUrl)
    workletRegistry[registryKey] = true
  } finally {
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

export async function createInputGraph(
  audioContext: AudioContext,
  requestedChannelCount: AudioChannelCount,
  handlers: RecorderInputHandlers
): Promise<InputGraph> {
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  // 仅移动端 AudioWorklet 路径启用帧缓冲，目标约 60Hz
  const batchSamples = isMobile ? Math.round(audioContext.sampleRate / 60) : 0

  const workletNodeConstructor = getAudioWorkletNodeConstructor()
  if (workletNodeConstructor) {
    try {
      await ensureRecorderWorkletRegistered(audioContext, batchSamples)

      let activeSession: InputGraphSessionSink | undefined
      const workletNode = new workletNodeConstructor(
        audioContext,
        RECORDER_WORKLET_PROCESSOR_NAME,
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: requestedChannelCount,
          channelCountMode: "explicit",
          outputChannelCount: [requestedChannelCount],
          processorOptions: { batchSamples },
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
          const planar = payload.planar.slice(
            0,
            resolveChannelCount(payload.channelCount)
          )
          activeSession.acceptFrame(planar, performance.now())
        }
      }

      return {
        inputNode: workletNode,
        deactivateInputNode: () => {
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

  let activeSession: InputGraphSessionSink | undefined
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
    inputNode: scriptProcessorNode,
    deactivateInputNode: () => {
      scriptProcessorNode.onaudioprocess = null
    },
    bindSession: (session) => {
      activeSession = session
    },
  }
}
