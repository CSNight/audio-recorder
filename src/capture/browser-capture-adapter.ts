import type {
  CaptureAdapter,
  CaptureHandlers,
  CaptureOpenRequest,
  CaptureSession,
  CaptureSessionSummary,
} from "./types"
import {
  CaptureSessionState,
  RecorderWarningCode,
  type AudioChannelCount,
} from "../types"
import { createAudioFrame, resolveChannelCount } from "../utils/audio-frame"

type AudioContextConstructor = typeof AudioContext
type AudioContextScope = typeof globalThis & {
  webkitAudioContext?: AudioContextConstructor
}

type AudioWorkletProcessorMessage =
  | {
      type: "frame"
      planar: Float32Array[]
      channelCount: number
      frameLength: number
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

function getAudioContextConstructor(): AudioContextConstructor {
  const scope = globalThis as AudioContextScope
  const audioContextConstructor = scope.AudioContext ?? scope.webkitAudioContext

  if (!audioContextConstructor) {
    throw new Error("AudioContext is not available in the current environment.")
  }

  return audioContextConstructor
}

function createConstraints(
  capture: CaptureOpenRequest["capture"]
): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = {}

  if (capture?.sampleRate !== undefined) {
    constraints.sampleRate = capture.sampleRate
  }
  if (capture?.channelCount !== undefined) {
    constraints.channelCount = capture.channelCount
  }
  if (capture?.echoCancellation !== undefined) {
    constraints.echoCancellation = capture.echoCancellation
  }
  if (capture?.noiseSuppression !== undefined) {
    constraints.noiseSuppression = capture.noiseSuppression
  }
  if (capture?.autoGainControl !== undefined) {
    constraints.autoGainControl = capture.autoGainControl
  }

  return constraints
}

function createWorkletModuleSource(): string {
  return `
class AudioRecorderFrameProcessor extends AudioWorkletProcessor {
  process(inputs) {
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
      frameLength,
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

class BrowserCaptureSession implements CaptureSession {
  private readonly sourceNode: MediaStreamAudioSourceNode
  private readonly sinkNode: GainNode
  private readonly ownsStream: boolean
  private readonly handlers: CaptureHandlers
  private readonly summary: CaptureSessionSummary = {
    frames: 0,
    durationMs: 0,
  }
  private readonly requestedChannelCount: AudioChannelCount
  private readonly captureNode: AudioNode
  private readonly deactivateCaptureNode: () => void
  private sessionState = CaptureSessionState.Ready
  private activeChannelCount: AudioChannelCount
  private hasWarnedChannelAdjustment = false

  constructor(options: {
    audioContext: AudioContext
    stream: MediaStream
    handlers: CaptureHandlers
    requestedChannelCount: AudioChannelCount
    ownsStream: boolean
    captureNode: AudioNode
    deactivateCaptureNode: () => void
  }) {
    this.audioContext = options.audioContext
    this.handlers = options.handlers
    this.requestedChannelCount = options.requestedChannelCount
    this.activeChannelCount = options.requestedChannelCount
    this.ownsStream = options.ownsStream
    this.captureNode = options.captureNode
    this.deactivateCaptureNode = options.deactivateCaptureNode

    this.sourceNode = options.audioContext.createMediaStreamSource(
      options.stream
    )
    this.sinkNode = options.audioContext.createGain()
    this.sinkNode.gain.value = 0

    this.sourceNode.connect(this.captureNode)
    this.captureNode.connect(this.sinkNode)
    this.sinkNode.connect(options.audioContext.destination)
  }

  private readonly audioContext: AudioContext

  get actualSampleRate(): number {
    return this.audioContext.sampleRate
  }

  get actualChannelCount(): AudioChannelCount {
    return this.activeChannelCount
  }

  acceptFrame(planarFloat: readonly Float32Array[], timestamp: number): void {
    if (this.sessionState !== CaptureSessionState.Recording) {
      return
    }

    const nextChannelCount = resolveChannelCount(planarFloat.length)
    this.activeChannelCount = nextChannelCount
    this.reportChannelCountAdjustmentIfNeeded(nextChannelCount)

    const frame = createAudioFrame(
      planarFloat,
      this.audioContext.sampleRate,
      timestamp
    )

    this.summary.frames += 1
    this.summary.durationMs += frame.durationMs
    this.handlers.onFrame(frame)
  }

  async start(): Promise<void> {
    this.assertState([
      CaptureSessionState.Ready,
      CaptureSessionState.Stopped,
      CaptureSessionState.Paused,
    ])
    this.sessionState = CaptureSessionState.Recording
    await this.audioContext.resume()
  }

  pause(): void {
    this.assertState([CaptureSessionState.Recording])
    this.sessionState = CaptureSessionState.Paused
  }

  async resume(): Promise<void> {
    this.assertState([CaptureSessionState.Paused])
    this.sessionState = CaptureSessionState.Recording
    await this.audioContext.resume()
  }

  async stop(): Promise<CaptureSessionSummary> {
    this.assertState([
      CaptureSessionState.Recording,
      CaptureSessionState.Paused,
      CaptureSessionState.Ready,
      CaptureSessionState.Stopped,
    ])
    this.sessionState = CaptureSessionState.Stopped

    return {
      frames: this.summary.frames,
      durationMs: this.summary.durationMs,
    }
  }

  async close(): Promise<void> {
    if (this.sessionState === CaptureSessionState.Closed) {
      return
    }

    this.sessionState = CaptureSessionState.Closed
    this.deactivateCaptureNode()
    this.sourceNode.disconnect()
    this.captureNode.disconnect()
    this.sinkNode.disconnect()

    if (this.ownsStream) {
      for (const track of this.sourceNode.mediaStream.getTracks()) {
        track.stop()
      }
    }

    if (this.audioContext.state !== "closed") {
      await this.audioContext.close()
    }
  }

  private assertState(allowedStates: CaptureSessionState[]): void {
    if (allowedStates.includes(this.sessionState)) {
      return
    }

    throw new Error(
      `Capture session state "${this.sessionState}" does not allow this operation.`
    )
  }

  private reportChannelCountAdjustmentIfNeeded(
    actualChannelCount: AudioChannelCount
  ): void {
    if (
      this.hasWarnedChannelAdjustment ||
      actualChannelCount === this.requestedChannelCount
    ) {
      return
    }

    this.hasWarnedChannelAdjustment = true
    this.handlers.onWarning({
      code: RecorderWarningCode.ChannelCountAdjusted,
      message: `Requested ${this.requestedChannelCount} channel(s) but the active stream reported ${actualChannelCount}.`,
    })
  }
}

export class BrowserCaptureAdapter implements CaptureAdapter {
  async open(
    request: CaptureOpenRequest,
    handlers: CaptureHandlers
  ): Promise<CaptureSession> {
    const requestedChannelCount = request.capture?.channelCount ?? 1
    const stream =
      request.sourceStream ?? (await this.getUserMediaStream(request.capture))
    const ownsStream = !request.sourceStream
    const audioTracks = stream.getAudioTracks()

    if (audioTracks.length === 0) {
      throw new Error(
        "The provided MediaStream does not contain any audio tracks."
      )
    }

    const AudioContextConstructor = getAudioContextConstructor()
    const audioContext = request.capture?.sampleRate
      ? new AudioContextConstructor({
          sampleRate: request.capture.sampleRate,
        })
      : new AudioContextConstructor()

    const captureGraph = await this.createCaptureGraph(
      audioContext,
      requestedChannelCount,
      handlers
    )

    const session = new BrowserCaptureSession({
      audioContext,
      stream,
      handlers,
      requestedChannelCount,
      ownsStream,
      captureNode: captureGraph.captureNode,
      deactivateCaptureNode: captureGraph.deactivateCaptureNode,
    })

    captureGraph.bindSession(session)
    return session
  }

  private async createCaptureGraph(
    audioContext: AudioContext,
    requestedChannelCount: AudioChannelCount,
    handlers: CaptureHandlers
  ): Promise<{
    captureNode: AudioNode
    deactivateCaptureNode: () => void
    bindSession: (session: BrowserCaptureSession) => void
  }> {
    const workletNodeConstructor = getAudioWorkletNodeConstructor()
    if (workletNodeConstructor) {
      try {
        await ensureRecorderWorkletRegistered(audioContext)

        let activeSession: BrowserCaptureSession | undefined
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
            handlers.onError(new Error(payload.message))
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
          captureNode: workletNode,
          deactivateCaptureNode: () => {
            workletNode.port.onmessage = null
          },
          bindSession: (session) => {
            activeSession = session
          },
        }
      } catch (error) {
        handlers.onWarning({
          code: RecorderWarningCode.ScriptProcessorFallback,
          message: buildWarningMessage(error),
        })
      }
    } else {
      handlers.onWarning({
        code: RecorderWarningCode.ScriptProcessorFallback,
        message:
          "AudioWorklet is unavailable, falling back to ScriptProcessor. AudioWorkletNode is not supported in this browser.",
      })
    }

    let activeSession: BrowserCaptureSession | undefined
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
      captureNode: scriptProcessorNode,
      deactivateCaptureNode: () => {
        scriptProcessorNode.onaudioprocess = null
      },
      bindSession: (session) => {
        activeSession = session
      },
    }
  }

  private async getUserMediaStream(
    capture?: CaptureOpenRequest["capture"]
  ): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("navigator.mediaDevices.getUserMedia is not available.")
    }

    return navigator.mediaDevices.getUserMedia({
      audio: createConstraints(capture),
      video: false,
    })
  }
}
