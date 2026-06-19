import type { RecorderInputHandlers } from "@/input/types"
import type { AudioChannelCount } from "@/types"
import { RecorderWarningCode } from "@/types"
import { resolveChannelCount } from "@/utils/audio-frame"
import {
  createWebMExtractScope,
  webmExtract,
  type WebMExtractScope,
} from "@/input/webm-pcm-extractor"

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
  /** 采集节点，AudioWorklet/ScriptProcessor 路径下接入 AudioGraph；MediaRecorder 路径下为占位 GainNode */
  inputNode: AudioNode
  /** 将 stream 接入采集图，BrowserInputSession.start() 前调用 */
  connect: (stream: MediaStream) => void
  /** 断开采集图连接，BrowserInputSession.close() 时调用 */
  disconnect: () => void
  deactivateInputNode: () => void
  bindSession: (session: InputGraphSessionSink) => void
  mode: "audio-graph" | "media-recorder"
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

// WeakMap 缓存已注册的 AudioWorklet，避免污染 audioWorklet 对象属性
const registeredWorklets = new WeakMap<AudioWorklet, boolean>()

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

  if (registeredWorklets.get(audioWorklet)) {
    return
  }

  // batchSamples 通过 processorOptions 传入，不需要注入 module source
  const moduleSource = createWorkletModuleSource(0)
  const moduleBlob = new Blob([moduleSource], {
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

const MEDIA_RECORDER_TIMESLICE_MS = 10 // ondataavailable 回调间隔
const MEDIA_RECORDER_TIMEOUT_MS = 500 // onstart 超时：超过此时长未进入 recording 状态则降级
const MEDIA_RECORDER_MIME = "audio/webm; codecs=pcm"

type MediaRecorderConstructorScope = typeof globalThis & {
  MediaRecorder?: {
    new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorder
    isTypeSupported?: (type: string) => boolean
  }
}

/**
 * 尝试以 MediaRecorder (audio/webm;codecs=pcm) 建立采集图。
 *
 * 返回成功建立的 InputGraph，或在以下情况返回 null（调用方应降级）：
 *  - 运行时不支持 MediaRecorder 或指定 MIME 类型
 *  - 500ms 内未触发 onstart（MediaRecorder 未能进入 recording 状态）
 *  - 构造或 start() 抛出异常
 *
 * connect(stream) 负责建立内部 Web Audio 路由图（强制声道数），
 * disconnect() 负责断开路由图并释放资源。
 */
async function createMediaRecorderInputGraphWithStream(
  stream: MediaStream,
  audioContext: AudioContext,
  requestedChannelCount: number,
  handlers: RecorderInputHandlers
): Promise<InputGraph | null> {
  const scope = globalThis as MediaRecorderConstructorScope
  if (
    !scope.MediaRecorder ||
    !scope.MediaRecorder.isTypeSupported?.(MEDIA_RECORDER_MIME)
  ) {
    return null
  }

  const MediaRecorderCtor = scope.MediaRecorder

  return new Promise<InputGraph | null>((resolve) => {
    let activeSession: InputGraphSessionSink | undefined
    let settled = false
    let mr: MediaRecorder | undefined
    const extractScope: WebMExtractScope = createWebMExtractScope()
    const timeout = { id: undefined as ReturnType<typeof setTimeout> | undefined }
    let hasSRWarned = false

    // 内部 Web Audio 路由图节点
    let internalSourceNode: MediaStreamAudioSourceNode | undefined
    let internalChannelRouter: GainNode | undefined
    let internalDestination: MediaStreamAudioDestinationNode | undefined

    function cleanupInternalGraph(): void {
      try {
        internalSourceNode?.disconnect()
      } catch {
        /* ignore */
      }
      try {
        internalChannelRouter?.disconnect()
      } catch {
        /* ignore */
      }
      try {
        internalDestination?.disconnect()
      } catch {
        /* ignore */
      }
      internalSourceNode = undefined
      internalChannelRouter = undefined
      internalDestination = undefined
    }

    function fallback(): void {
      if (settled) return
      settled = true
      clearTimeout(timeout.id)
      if (mr) {
        try {
          mr.stop()
        } catch {
          /* ignore */
        }
        mr.ondataavailable = null
        mr.onerror = null
        ;(mr as MediaRecorder & { onstart: null }).onstart = null
      }
      cleanupInternalGraph()
      resolve(null)
    }

    function succeed(): void {
      if (settled) return
      settled = true
      clearTimeout(timeout.id)
      const placeholderNode = audioContext.createGain()
      placeholderNode.gain.value = 0
      resolve({
        inputNode: placeholderNode,
        mode: "media-recorder",
        connect: (connectStream: MediaStream) => {
          // 通过 Web Audio 路由图强制声道数，避免 getUserMedia 约束被浏览器忽略
          internalSourceNode =
            audioContext.createMediaStreamSource(connectStream)
          internalChannelRouter = audioContext.createGain()
          internalChannelRouter.channelCount = requestedChannelCount
          internalChannelRouter.channelCountMode = "explicit"
          internalDestination = audioContext.createMediaStreamDestination()
          internalDestination.channelCount = requestedChannelCount
          internalDestination.channelCountMode = "explicit"
          internalSourceNode.connect(internalChannelRouter)
          internalChannelRouter.connect(internalDestination)
        },
        disconnect: cleanupInternalGraph,
        deactivateInputNode: () => {
          if (mr) {
            try {
              mr.stop()
            } catch {
              /* ignore */
            }
            mr.ondataavailable = null
            mr.onerror = null
          }
        },
        bindSession: (session) => {
          activeSession = session
        },
      })
    }

    // 建立路由图并创建 MediaRecorder
    try {
      internalSourceNode = audioContext.createMediaStreamSource(stream)
      internalChannelRouter = audioContext.createGain()
      internalChannelRouter.channelCount = requestedChannelCount
      internalChannelRouter.channelCountMode = "explicit"
      internalDestination = audioContext.createMediaStreamDestination()
      internalDestination.channelCount = requestedChannelCount
      internalDestination.channelCountMode = "explicit"
      internalSourceNode.connect(internalChannelRouter)
      internalChannelRouter.connect(internalDestination)
      mr = new MediaRecorderCtor(internalDestination.stream, {
        mimeType: MEDIA_RECORDER_MIME,
      })
    } catch {
      cleanupInternalGraph()
      resolve(null)
      return
    }

    // onstart 触发即表示 MediaRecorder 成功进入 recording 状态，路径可用
    ;(mr as MediaRecorder & { onstart: (() => void) | null }).onstart = () => {
      succeed()
    }

    mr.ondataavailable = (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return
      if (!activeSession) return

      event.data
        .arrayBuffer()
        .then((buf) => {
          if (!activeSession) return
          const inBytes = new Uint8Array(buf)
          const result = webmExtract(inBytes, extractScope)

          if (result === "invalid") {
            handlers.onIssue({
              kind: "warning",
              warning: {
                code: RecorderWarningCode.MediaRecorderFallback,
                message:
                  "MediaRecorder produced unrecognised WebM/PCM data; falling back.",
              },
            })
            return
          }

          if (result === null) return

          // 采样率不匹配时只警告一次
          if (
            !hasSRWarned &&
            extractScope.webmSR !== undefined &&
            extractScope.webmSR !== audioContext.sampleRate
          ) {
            hasSRWarned = true
            handlers.onIssue({
              kind: "warning",
              warning: {
                code: RecorderWarningCode.MediaRecorderFallback,
                message: `MediaRecorder sample rate (${extractScope.webmSR}) differs from AudioContext (${audioContext.sampleRate}).`,
              },
            })
          }

          activeSession.acceptFrame(result, performance.now())
        })
        .catch(() => {
          /* ignore read errors */
        })
    }

    mr.onerror = () => {
      if (!settled) fallback()
    }

    timeout.id = setTimeout(() => {
      if (!settled) fallback()
    }, MEDIA_RECORDER_TIMEOUT_MS)

    try {
      mr.start(MEDIA_RECORDER_TIMESLICE_MS)
    } catch {
      clearTimeout(timeout.id)
      cleanupInternalGraph()
      resolve(null)
    }
  })
}

export async function createInputGraph(
  audioContext: AudioContext,
  requestedChannelCount: AudioChannelCount,
  handlers: RecorderInputHandlers,
  options?: {
    preferMediaRecorder?: boolean
    stream?: MediaStream
  }
): Promise<InputGraph> {
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
  // 仅移动端 AudioWorklet 路径启用帧缓冲，目标约 60Hz
  const batchSamples = isMobile ? Math.round(audioContext.sampleRate / 60) : 0

  // ── 第一级：MediaRecorder (audio/webm;codecs=pcm) ─────────────────────────
  if (options?.preferMediaRecorder !== false && options?.stream) {
    const mrGraph = await createMediaRecorderInputGraphWithStream(
      options.stream,
      audioContext,
      requestedChannelCount,
      handlers
    )
    if (mrGraph) return mrGraph

    handlers.onIssue({
      kind: "warning",
      warning: {
        code: RecorderWarningCode.MediaRecorderFallback,
        message:
          "MediaRecorder (audio/webm;codecs=pcm) unavailable or timed out; falling back to AudioWorklet/ScriptProcessor.",
      },
    })
  }

  // ── 第二级：AudioWorklet ──────────────────────────────────────────────────
  const workletNodeConstructor = getAudioWorkletNodeConstructor()
  if (workletNodeConstructor) {
    try {
      await ensureRecorderWorkletRegistered(audioContext)

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
        if (!activeSession) return

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

      let sourceNode: MediaStreamAudioSourceNode | undefined
      let sinkNode: GainNode | undefined

      return {
        inputNode: workletNode,
        mode: "audio-graph",
        connect: (stream: MediaStream) => {
          sourceNode = audioContext.createMediaStreamSource(stream)
          sinkNode = audioContext.createGain()
          sinkNode.gain.value = 0
          sourceNode.connect(workletNode)
          workletNode.connect(sinkNode)
          sinkNode.connect(audioContext.destination)
        },
        disconnect: () => {
          try {
            sourceNode?.disconnect()
          } catch {
            /* ignore */
          }
          try {
            workletNode.disconnect()
          } catch {
            /* ignore */
          }
          try {
            sinkNode?.disconnect()
          } catch {
            /* ignore */
          }
          sourceNode = undefined
          sinkNode = undefined
        },
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

  // ── 第三级：ScriptProcessor（降级兜底）────────────────────────────────────
  let activeSession: InputGraphSessionSink | undefined
  // ScriptProcessor is deprecated and kept strictly as the runtime fallback path.
  const scriptProcessorNode = audioContext.createScriptProcessor(
    4096,
    requestedChannelCount,
    requestedChannelCount
  )

  scriptProcessorNode.onaudioprocess = (event) => {
    if (!activeSession) return

    const actualChannelCount = resolveChannelCount(
      event.inputBuffer.numberOfChannels
    )
    const planarFloat = Array.from(
      { length: actualChannelCount },
      (_, channelIndex) => event.inputBuffer.getChannelData(channelIndex)
    )

    activeSession.acceptFrame(planarFloat, performance.now())
  }

  let spSourceNode: MediaStreamAudioSourceNode | undefined
  let spSinkNode: GainNode | undefined

  return {
    inputNode: scriptProcessorNode,
    mode: "audio-graph",
    connect: (stream: MediaStream) => {
      spSourceNode = audioContext.createMediaStreamSource(stream)
      spSinkNode = audioContext.createGain()
      spSinkNode.gain.value = 0
      spSourceNode.connect(scriptProcessorNode)
      scriptProcessorNode.connect(spSinkNode)
      spSinkNode.connect(audioContext.destination)
    },
    disconnect: () => {
      try {
        spSourceNode?.disconnect()
      } catch {
        /* ignore */
      }
      try {
        scriptProcessorNode.disconnect()
      } catch {
        /* ignore */
      }
      try {
        spSinkNode?.disconnect()
      } catch {
        /* ignore */
      }
      spSourceNode = undefined
      spSinkNode = undefined
    },
    deactivateInputNode: () => {
      scriptProcessorNode.onaudioprocess = null
    },
    bindSession: (session) => {
      activeSession = session
    },
  }
}
