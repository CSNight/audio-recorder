import type { AudioFrame } from "@/types"
import type { RecorderPlugin } from "@/plugins/types"
import type { RecorderPluginEventContext } from "@/plugins/types"
import type { StreamingChunkPayload } from "@/plugins/streaming-export/types"
import type {
  StreamingPlayerEncoderDefinition,
  StreamingPlayerPluginOptions,
} from "@/plugins/streaming-player/types"

export function createStreamingPlayerPlugin(
  options: StreamingPlayerPluginOptions = {}
): RecorderPlugin {
  const volume = options.volume ?? 1
  const source = options.source ?? { type: "pcm-frame" as const }
  const sourceEncoder =
    source.type === "plugin-event"
      ? resolveStreamingPlayerEncoder(source.format, source.encoders)
      : undefined

  let audioContext: AudioContext | undefined
  let gainNode: GainNode | undefined
  let nextStartTime = 0
  let isActive = false
  let unsubscribe: (() => void) | undefined

  const ensureAudioGraph = async () => {
    if (!audioContext) {
      audioContext = new AudioContext()
      gainNode = audioContext.createGain()
      gainNode.gain.value = volume
      gainNode.connect(audioContext.destination)
    }

    if (audioContext.state === "suspended" && options.autoPlay !== false) {
      await audioContext.resume()
    }
  }

  const scheduleBuffer = (buffer: AudioBuffer) => {
    if (!audioContext || !gainNode) {
      return
    }

    const sourceNode = audioContext.createBufferSource()
    sourceNode.buffer = buffer
    sourceNode.connect(gainNode)

    const startTime = Math.max(audioContext.currentTime, nextStartTime)
    sourceNode.start(startTime)
    nextStartTime = startTime + buffer.duration
  }

  const playPcmFrame = async (frame: AudioFrame) => {
    if (!isActive) {
      return
    }

    await ensureAudioGraph()
    if (!audioContext) {
      return
    }

    const frameLength = frame.planar[0]?.length ?? 0
    if (frameLength === 0) {
      return
    }

    const buffer = audioContext.createBuffer(
      frame.channels,
      frameLength,
      frame.sampleRate
    )

    for (let channel = 0; channel < frame.channels; channel += 1) {
      const output = buffer.getChannelData(channel)
      const input =
        frame.planar[channel] ?? frame.planar[0] ?? new Int16Array(0)
      for (let index = 0; index < frameLength; index += 1) {
        output[index] = (input[index] ?? 0) / 32768
      }
    }

    scheduleBuffer(buffer)
  }

  const playEncodedChunk = async (
    event: RecorderPluginEventContext<StreamingChunkPayload>
  ) => {
    if (!isActive) {
      return
    }
    if (source.type !== "plugin-event") {
      return
    }

    await ensureAudioGraph()
    if (!audioContext) {
      return
    }

    const audioBuffer = await sourceEncoder!.decode(audioContext, event.payload)
    scheduleBuffer(audioBuffer)
  }

  return {
    name: `streaming-player:${source.type}`,

    setup(context) {
      if (source.type === "plugin-event") {
        unsubscribe = context.recorder.on(source.event, (event) => {
          void playEncodedChunk(
            event as RecorderPluginEventContext<StreamingChunkPayload>
          )
        })
      }
    },

    onStart() {
      isActive = true
      nextStartTime = 0
    },

    onFrame(frame) {
      if (source.type === "pcm-frame") {
        void playPcmFrame(frame)
      }
    },

    onPause() {
      isActive = false
      void audioContext?.suspend()
    },

    onResume() {
      isActive = true
      void audioContext?.resume()
    },

    onStop() {
      isActive = false
    },

    async dispose() {
      isActive = false
      unsubscribe?.()
      unsubscribe = undefined
      await audioContext?.close()
      audioContext = undefined
      gainNode = undefined
      nextStartTime = 0
    },
  }
}

function resolveStreamingPlayerEncoder(
  format: string,
  encoders: StreamingPlayerEncoderDefinition[]
): StreamingPlayerEncoderDefinition {
  for (const encoder of encoders) {
    if (encoder.format === format) {
      return encoder
    }
  }

  throw new Error(
    `Streaming player encoder for format "${format}" not found. ` +
      `Please pass the corresponding encoder definition via source.encoders.`
  )
}
