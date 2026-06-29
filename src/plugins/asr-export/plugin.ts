import type { PcmBufferSnapshot } from "@/buffer/types"
import type { ExportEncoderDefinition } from "@/types"
import type { RecorderPlugin } from "@/plugins/types"
import { resample } from "@csnight/audio-recorder"
import type {
  AsrChunkPayload,
  AsrExportFormat,
  AsrExportPluginOptions,
} from "@/plugins/asr-export/types"

const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_CHUNK_DURATION_MS = 40

export function createAsrExportPlugin(
  options: AsrExportPluginOptions
): RecorderPlugin {
  const format = options.format ?? "pcm"
  const encoderDefinition = resolveAsrEncoder(format, options.encoders)
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE
  const chunkDurationMs = options.chunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS
  const bitsPerSample = options.bitsPerSample ?? 16

  if (options.channels !== undefined && options.channels !== 1) {
    throw new Error("ASR export only supports mono output (`channels: 1`).")
  }
  if (bitsPerSample !== 16) {
    throw new Error("ASR export currently only supports 16-bit output.")
  }
  if (chunkDurationMs <= 0) {
    throw new Error("ASR chunkDurationMs must be positive.")
  }

  const samplesPerChunk = Math.max(
    1,
    Math.round((sampleRate * chunkDurationMs) / 1000)
  )

  let bufferedMono: Int16Array = new Int16Array(0)
  let sequenceIndex = 0
  let isActive = false
  let emitChunk: ((payload: AsrChunkPayload) => void) | undefined

  const emitBufferedChunks = (timestampMs: number, isFinal: boolean) => {
    while (bufferedMono.length >= samplesPerChunk) {
      const frame = bufferedMono.subarray(0, samplesPerChunk)
      bufferedMono = new Int16Array(bufferedMono.subarray(samplesPerChunk))
      emitChunk?.(
        createChunkPayload(
          encoderDefinition,
          frame,
          sampleRate,
          bitsPerSample,
          sequenceIndex++,
          timestampMs,
          false
        )
      )
    }

    if (isFinal && bufferedMono.length > 0) {
      const padded = new Int16Array(samplesPerChunk)
      padded.set(bufferedMono)
      bufferedMono = new Int16Array(0)
      emitChunk?.(
        createChunkPayload(
          encoderDefinition,
          padded,
          sampleRate,
          bitsPerSample,
          sequenceIndex++,
          timestampMs,
          true
        )
      )
    }
  }

  return {
    name: `asr-export:${format}`,

    setup(context) {
      context.eventBus.register("plugin:asr:chunk")
      emitChunk = (payload) => {
        context.eventBus.emit("plugin:asr:chunk", payload)
      }
      void encoderDefinition.preload?.()
    },

    onStart() {
      bufferedMono = new Int16Array(0)
      sequenceIndex = 0
      isActive = true
    },

    onFrame(frame) {
      if (!isActive) {
        return
      }

      const mono = normalizeFrameToMono(
        frame.planar,
        frame.sampleRate,
        sampleRate
      )
      if (mono.length === 0) {
        return
      }

      bufferedMono = appendSamples(bufferedMono, mono)
      emitBufferedChunks(frame.timestamp, false)
    },

    onPause() {
      isActive = false
    },

    onResume() {
      isActive = true
    },

    onStop() {
      isActive = false
      emitBufferedChunks(performance.now(), true)
    },

    dispose() {
      isActive = false
      bufferedMono = new Int16Array(0)
      emitChunk = undefined
    },
  }
}

function appendSamples(target: Int16Array, incoming: Int16Array): Int16Array {
  if (target.length === 0) {
    return incoming.slice()
  }

  const merged = new Int16Array(target.length + incoming.length)
  merged.set(target)
  merged.set(incoming, target.length)
  return merged
}

function downmixToMono(planar: Int16Array[]): Int16Array {
  const frameLength = planar[0]?.length ?? 0
  if (planar.length <= 1) {
    return planar[0] ? new Int16Array(planar[0]) : new Int16Array(0)
  }

  const mono = new Int16Array(frameLength)
  for (let index = 0; index < frameLength; index += 1) {
    let total = 0
    for (let channel = 0; channel < planar.length; channel += 1) {
      total += planar[channel]?.[index] ?? 0
    }
    mono[index] = Math.round(total / planar.length)
  }
  return mono
}

function normalizeFrameToMono(
  planar: Int16Array[],
  sampleRate: number,
  targetSampleRate: number
): Int16Array {
  const mono = downmixToMono(planar)
  if (mono.length === 0) {
    return mono
  }
  if (sampleRate === targetSampleRate) {
    return mono
  }

  const snapshot: PcmBufferSnapshot = {
    sampleRate,
    channels: 1,
    frameCount: 1,
    durationMs: (mono.length / sampleRate) * 1000,
    planar: [mono],
  }

  return resample(snapshot, targetSampleRate, { isHQ: false }).planar[0]!
}

function createChunkPayload(
  encoderDefinition: ExportEncoderDefinition,
  mono: Int16Array,
  sampleRate: number,
  bitsPerSample: 16,
  sequenceIndex: number,
  timestampMs: number,
  isFinal: boolean
): AsrChunkPayload {
  const snapshot: PcmBufferSnapshot = {
    sampleRate,
    channels: 1,
    frameCount: 1,
    durationMs: (mono.length / sampleRate) * 1000,
    planar: [mono],
  }

  const format = encoderDefinition.type as AsrExportFormat
  const result = encoderDefinition.export(snapshot, { bitRate: bitsPerSample })
  const chunk =
    format === "wav"
      ? new Uint8Array((result as { arrayBuffer: ArrayBuffer }).arrayBuffer)
      : toUint8Array((result as { data: Int8Array | Int16Array }).data)

  return {
    format,
    chunk,
    sequenceIndex,
    timestampMs,
    durationMs: snapshot.durationMs,
    sampleRate,
    channels: 1,
    isFinal,
  }
}

function toUint8Array(data: Int8Array | Int16Array): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function resolveAsrEncoder(
  format: AsrExportFormat,
  encoders: ExportEncoderDefinition[]
): ExportEncoderDefinition {
  for (const encoder of encoders) {
    if (encoder.type === format) {
      return encoder
    }
  }

  throw new Error(
    `ASR export encoder for format "${format}" not found. ` +
      `Please pass the corresponding ExportEncoderDefinition via options.encoders.`
  )
}
