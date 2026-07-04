import type {
  AudioFrame,
  StreamEncoderDefinition,
  StreamingPacketPayload,
} from "../../types"
import { ChunkedEncoderBridge } from "../../workers/chunked-encoder-bridge"
import { mergeChannelChunks } from "../../buffer/pcm-buffer-utils"
import { transformInterleavedBlock } from "./sonic-processor"
import type { NormalizedSonicTransformOptions } from "./types"

interface PendingTime {
  startMs: number | null
  durationMs: number
  nextMs: number | null
  discontinuity: boolean
}

interface SonicStreamBridgeOptions {
  format: string
  definition: StreamEncoderDefinition
  encoderOptions?: unknown
  allowMainThreadFallback?: boolean | undefined
  streamId: string
  metadata?: Record<string, unknown> | undefined
  createSessionId?: (() => string) | undefined
  transformOptions: NormalizedSonicTransformOptions
  emitPacket: (payload: StreamingPacketPayload) => void
}

function makePendingTime(): PendingTime {
  return { startMs: null, durationMs: 0, nextMs: null, discontinuity: false }
}

function generateSessionId(): string {
  return `session-${crypto.randomUUID()}`
}

export function createSonicStreamBridge(options: SonicStreamBridgeOptions) {
  const {
    format,
    definition,
    encoderOptions,
    allowMainThreadFallback,
    streamId,
    metadata,
    createSessionId,
    transformOptions,
    emitPacket,
  } = options

  const bridge = new ChunkedEncoderBridge({
    format,
    definition,
    encoderOptions,
    allowMainThreadFallback,
  })

  let isActive = false
  let sessionId = ""
  let seq = 0
  let lastSampleRate = 0
  let lastChannels = 0
  let pending = makePendingTime()
  let bufferedDurationMs = 0
  const bufferedFrames: AudioFrame[] = []
  let queue = Promise.resolve()

  function resetSession(): void {
    isActive = false
    sessionId = ""
    seq = 0
    lastSampleRate = 0
    lastChannels = 0
    pending = makePendingTime()
    bufferedFrames.length = 0
    bufferedDurationMs = 0
  }

  async function flushBufferedFrames(): Promise<void> {
    if (bufferedFrames.length === 0) {
      return Promise.resolve()
    }

    const firstFrame = bufferedFrames[0]!
    const channels = firstFrame.channels
    const sampleRate = firstFrame.sampleRate
    const timestampMs = pending.nextMs ?? firstFrame.timestamp
    const planar = Array.from({ length: channels }, () => [] as Int16Array[])

    for (const frame of bufferedFrames) {
      for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
        planar[channelIndex]!.push(
          frame.planar[channelIndex] ?? new Int16Array(0)
        )
      }
    }

    bufferedFrames.length = 0
    bufferedDurationMs = 0

    const mergedPlanar = planar.map((chunks) => mergeChannelChunks(chunks))
    const transformed = transformInterleavedBlock(
      interleavePlanar(mergedPlanar, channels),
      sampleRate,
      channels,
      transformOptions
    )
    if (transformed.length === 0) {
      return Promise.resolve()
    }

    const transformedPlanar = deinterleavePlanar(transformed, channels)
    const durationMs = (transformedPlanar[0]!.length / sampleRate) * 1000

    lastSampleRate = sampleRate
    lastChannels = channels

    return bridge
      .feedFrame(channels, sampleRate, transformedPlanar)
      .then((chunk) => {
        if (pending.startMs === null) {
          pending.startMs = timestampMs
        }
        pending.durationMs += durationMs

        if (chunk === null) {
          return
        }

        const packet: StreamingPacketPayload = {
          streamId,
          sessionId,
          seq: seq++,
          timestampMs: pending.startMs ?? timestampMs,
          durationMs: pending.durationMs,
          sampleRate,
          channels,
          format,
          chunk,
          isFinal: false,
        }
        if (pending.discontinuity) {
          packet.discontinuity = true
        }
        if (metadata !== undefined) {
          packet.metadata = metadata
        }

        emitPacket(packet)
        pending.nextMs = packet.timestampMs + packet.durationMs
        pending.startMs = null
        pending.durationMs = 0
        pending.discontinuity = false
      })
      .catch(() => undefined)
  }

  function enqueue(task: () => Promise<void>): void {
    queue = queue.then(task).catch(() => undefined)
  }

  return {
    start(): void {
      bridge.reset(encoderOptions)
      resetSession()
      sessionId = createSessionId?.() ?? generateSessionId()
      isActive = true
    },

    feedFrame(frame: AudioFrame): void {
      if (!isActive) {
        return
      }

      enqueue(async () => {
        if (!isActive) {
          return
        }

        const firstFrame = bufferedFrames[0]
        if (
          firstFrame &&
          (firstFrame.channels !== frame.channels ||
            firstFrame.sampleRate !== frame.sampleRate)
        ) {
          await flushBufferedFrames()
        }

        bufferedFrames.push(frame)
        bufferedDurationMs += frame.durationMs

        if (bufferedDurationMs >= transformOptions.blockMs) {
          await flushBufferedFrames()
        }
      })
    },

    pause(): void {
      isActive = false
    },

    resume(): void {
      isActive = true
      pending.discontinuity = true
    },

    stop(): void {
      isActive = false
      const capturedSessionId = sessionId

      enqueue(async () => {
        await flushBufferedFrames()
        const chunk = await bridge.flush().catch(() => null)
        if (chunk === null || capturedSessionId !== sessionId) {
          return
        }

        const packet: StreamingPacketPayload = {
          streamId,
          sessionId: capturedSessionId,
          seq: seq++,
          timestampMs: pending.startMs ?? pending.nextMs ?? 0,
          durationMs: pending.durationMs,
          sampleRate: lastSampleRate,
          channels: lastChannels,
          format,
          chunk,
          isFinal: true,
        }
        if (pending.discontinuity) {
          packet.discontinuity = true
        }
        if (metadata !== undefined) {
          packet.metadata = metadata
        }

        emitPacket(packet)
      })
    },

    dispose(): void {
      resetSession()
      bridge.dispose()
    },
  }
}

function interleavePlanar(
  planar: readonly Int16Array[],
  channels: number
): Int16Array {
  const frameLength = planar[0]?.length ?? 0
  const output = new Int16Array(frameLength * channels)

  for (let frameIndex = 0; frameIndex < frameLength; frameIndex += 1) {
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      output[frameIndex * channels + channelIndex] =
        planar[channelIndex]?.[frameIndex] ?? 0
    }
  }

  return output
}

function deinterleavePlanar(
  source: Int16Array,
  channels: number
): Int16Array[] {
  const frameLength = Math.floor(source.length / channels)
  return Array.from({ length: channels }, (_, channelIndex) => {
    const output = new Int16Array(frameLength)
    for (let frameIndex = 0; frameIndex < frameLength; frameIndex += 1) {
      output[frameIndex] = source[frameIndex * channels + channelIndex] ?? 0
    }
    return output
  })
}
