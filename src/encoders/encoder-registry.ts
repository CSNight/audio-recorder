import type { PcmBufferSnapshot } from "@/buffer/types"
import { exportPcmSnapshot } from "@/codecs/pcm/pcm-exporter"
import type { PcmExportOptions, PcmExportResult } from "@/codecs/pcm/types"
import { exportWavSnapshot } from "@/codecs/wav/wav-exporter"
import type { WavExportOptions, WavExportResult } from "@/codecs/wav/types"

export interface SnapshotEncoderDefinition<TOptions, TResult> {
  type: string
  export(snapshot: PcmBufferSnapshot, options?: TOptions): TResult
}

/**
 * Fix #4: Discriminated union map that links encoder names to their option/result
 * types, enabling fully type-safe `export()` calls without casting at call sites.
 */
export interface EncoderMap {
  pcm: { options: PcmExportOptions; result: PcmExportResult }
  wav: { options: WavExportOptions; result: WavExportResult }
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

  /**
   * Type-safe overload for known encoder names declared in {@link EncoderMap}.
   * Callers that pass a literal key (e.g. `"pcm"`) get the correct result type
   * inferred automatically without any manual generic arguments.
   */
  export<TKey extends keyof EncoderMap>(
    type: TKey,
    snapshot: PcmBufferSnapshot,
    options?: EncoderMap[TKey]["options"]
  ): EncoderMap[TKey]["result"]

  /** Fallback overload for dynamically registered encoders not in EncoderMap. */
  export<TOptions, TResult>(
    type: string,
    snapshot: PcmBufferSnapshot,
    options?: TOptions
  ): TResult

  export(
    type: string,
    snapshot: PcmBufferSnapshot,
    options?: unknown
  ): unknown {
    const encoder = this.encoders.get(type)

    if (!encoder) {
      throw new Error(`Recorder encoder "${type}" is not registered.`)
    }

    return encoder.export(snapshot, options)
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
