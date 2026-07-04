import type { PcmBufferSnapshot } from "../../buffer/types"
import type {
  StreamEncoderDefinition,
  StreamingPacketPayload,
} from "../../types"
import { interleaveSnapshot } from "./utils"
import { createSonicStreamBridge } from "./stream-bridge"
import {
  normalizeSonicTransformOptions,
  transformInterleavedPcm,
} from "./sonic-processor"
import type {
  SonicExportOptions,
  SonicExportPlugin,
  SonicTransformOptions,
} from "./types"

function generateStreamId(): string {
  return `stream-${crypto.randomUUID()}`
}

export function createSonicExportPlugin(
  options: SonicExportOptions
): SonicExportPlugin {
  const {
    format,
    encoders,
    encoderOptions,
    allowMainThreadFallback,
    metadata,
    createSessionId,
  } = options

  const streamId =
    options.streamId ?? options.createStreamId?.() ?? generateStreamId()
  const definition = resolveStreamDefinition(format, encoders)
  const defaultTransformOptions = normalizeSonicTransformOptions(options)
  let streamBridge: ReturnType<typeof createSonicStreamBridge> | undefined

  return {
    name: `sonic-export:${format}`,
    exclusiveWith: ["streaming-export"],

    async setup(context) {
      context.eventBus.register("plugin:stream")
      const emitPacket = (payload: StreamingPacketPayload) =>
        context.eventBus.emit("plugin:stream", payload)

      await definition.preload?.()
      streamBridge = createSonicStreamBridge({
        format,
        definition,
        encoderOptions,
        allowMainThreadFallback,
        streamId,
        metadata,
        createSessionId,
        transformOptions: defaultTransformOptions,
        emitPacket,
      })
    },

    onStart() {
      streamBridge?.start()
    },

    onFrame(frame) {
      streamBridge?.feedFrame(frame)
    },

    onPause() {
      streamBridge?.pause()
    },

    onResume() {
      streamBridge?.resume()
    },

    onStop() {
      streamBridge?.stop()
    },

    dispose() {
      streamBridge?.dispose()
      streamBridge = undefined
    },

    async transform(
      pcm: Int16Array,
      sampleRate: number,
      channelsOrOptions?: number | SonicTransformOptions,
      transformOptions?: SonicTransformOptions
    ) {
      const channels =
        typeof channelsOrOptions === "number" ? channelsOrOptions : 1
      const resolvedOptions =
        typeof channelsOrOptions === "number"
          ? transformOptions
          : channelsOrOptions

      return transformInterleavedPcm(pcm, sampleRate, channels, {
        ...options,
        ...resolvedOptions,
      })
    },

    async transformSnapshot(
      snapshot: PcmBufferSnapshot,
      transformOptions?: SonicTransformOptions
    ) {
      const interleaved = interleaveSnapshot(snapshot)
      return transformInterleavedPcm(
        interleaved,
        snapshot.sampleRate,
        snapshot.channels,
        {
          ...options,
          ...transformOptions,
        }
      )
    },
  }
}

function resolveStreamDefinition(
  format: string,
  encoders: StreamEncoderDefinition[]
): StreamEncoderDefinition {
  const definition = encoders.find((encoder) => encoder.format === format)
  if (definition) {
    return definition
  }

  const available = encoders.map((encoder) => encoder.format)
  throw new Error(
    `ChunkedEncoder for format "${format}" not found. ` +
      `Please pass the corresponding StreamEncoderDefinition via options.encoders. ` +
      `Available formats: ${available.join(", ") || "(none)"}`
  )
}
