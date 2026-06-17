import type { PcmBufferSnapshot } from "@/buffer/types"
import { createPcmEncoder } from "@/encoders/pcm"
import { createWavEncoder } from "@/encoders/wav"
import type { PcmExportOptions, PcmExportResult } from "@/codecs/pcm/types"
import type { WavExportOptions, WavExportResult } from "@/codecs/wav/types"
import type {
  Mp3ExportOptions,
  Mp3ExportResult,
} from "@/codecs/mp3/mp3-snapshot-types"

export interface SnapshotEncoderDefinition<
  TType extends string = string,
  TOptions = unknown,
  TResult = unknown,
> {
  type: TType
  export(snapshot: PcmBufferSnapshot, options?: TOptions): TResult
}

/**
 * Discriminated union map that links encoder names to their option/result
 * types, enabling fully type-safe `export()` calls without casting at call sites.
 */
export interface EncoderMap {
  pcm: { options: PcmExportOptions; result: PcmExportResult }
  wav: { options: WavExportOptions; result: WavExportResult }
  mp3: { options: Mp3ExportOptions; result: Mp3ExportResult }
}

export class EncoderRegistry {
  private readonly encoders = new Map<
    string,
    SnapshotEncoderDefinition<string, unknown, unknown>
  >()

  register<TType extends string, TOptions, TResult>(
    definition: SnapshotEncoderDefinition<TType, TOptions, TResult>
  ): void {
    if (this.encoders.has(definition.type)) {
      throw new Error(
        `Recorder encoder "${definition.type}" is already registered.`
      )
    }

    this.encoders.set(
      definition.type,
      definition as SnapshotEncoderDefinition<string, unknown, unknown>
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

  registry.register<"pcm", PcmExportOptions, PcmExportResult>(
    createPcmEncoder()
  )
  registry.register<"wav", WavExportOptions, WavExportResult>(
    createWavEncoder()
  )

  return registry
}
