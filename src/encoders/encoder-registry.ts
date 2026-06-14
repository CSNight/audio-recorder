import type { PcmBufferSnapshot } from "@/buffer/types"
import { exportPcmSnapshot } from "@/codecs/pcm/pcm-exporter"
import type { PcmExportOptions, PcmExportResult } from "@/codecs/pcm/types"
import { exportWavSnapshot } from "@/codecs/wav/wav-exporter"
import type { WavExportOptions, WavExportResult } from "@/codecs/wav/types"

export interface SnapshotEncoderDefinition<TOptions, TResult> {
  type: string
  export(snapshot: PcmBufferSnapshot, options?: TOptions): TResult
}

export class EncoderRegistry {
  private readonly encoders = new Map<
    string,
    SnapshotEncoderDefinition<unknown, unknown>
  >()

  register<TOptions, TResult>(
    definition: SnapshotEncoderDefinition<TOptions, TResult>
  ): void {
    if (this.encoders.has(definition.type)) {
      throw new Error(
        `Recorder encoder "${definition.type}" is already registered.`
      )
    }

    this.encoders.set(
      definition.type,
      definition as SnapshotEncoderDefinition<unknown, unknown>
    )
  }

  export<TOptions, TResult>(
    type: string,
    snapshot: PcmBufferSnapshot,
    options?: TOptions
  ): TResult {
    const encoder = this.encoders.get(type)

    if (!encoder) {
      throw new Error(`Recorder encoder "${type}" is not registered.`)
    }

    return (encoder as SnapshotEncoderDefinition<TOptions, TResult>).export(
      snapshot,
      options
    )
  }
}

export function createDefaultEncoderRegistry(): EncoderRegistry {
  const registry = new EncoderRegistry()

  registry.register<PcmExportOptions, PcmExportResult>({
    type: "pcm",
    export: (snapshot, options) => exportPcmSnapshot(snapshot, options),
  })
  registry.register<WavExportOptions, WavExportResult>({
    type: "wav",
    export: (snapshot, options) => exportWavSnapshot(snapshot, options),
  })

  return registry
}
