import type { StreamingChunkPayload } from "@/plugins/streaming-export/types"

export interface StreamingPlayerEncoderDefinition {
  format: string
  decode(
    audioContext: AudioContext,
    payload: StreamingChunkPayload
  ): Promise<AudioBuffer>
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
