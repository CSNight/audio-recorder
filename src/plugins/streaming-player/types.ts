import type { StreamingChunkPayload } from "@/plugins/streaming-export/types"

export interface DecodedAudioChunk {
  sampleRate: number
  channels: number
  planar: Float32Array[]
}

export interface StreamingPlayerEncoderDefinition {
  format: string
  decode(payload: StreamingChunkPayload): Promise<DecodedAudioChunk>
}

export interface StreamingPlayerPluginOptions {
  volume?: number
  autoPlay?: boolean
  source?:
    | { type: "pcm-frame" }
    | {
        type: "plugin-event"
        event: "plugin:encoded-chunk"
        format: "pcm" | "wav"
        encoders: StreamingPlayerEncoderDefinition[]
      }
}
