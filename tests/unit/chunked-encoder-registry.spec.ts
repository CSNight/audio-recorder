import { describe, expect, it } from "vitest"
import {
  ChunkedEncoderRegistry,
  defaultChunkedEncoderRegistry,
} from "@/plugins/streaming-export/registry"

describe("ChunkedEncoderRegistry", () => {
  it("registers and exposes encoder definitions", () => {
    const registry = new ChunkedEncoderRegistry()
    const firstDefinition = {
      format: "pcm",
      create: () => ({
        feedFrame: () => null,
        flush: () => null,
        dispose: () => undefined,
      }),
    }
    const secondDefinition = {
      format: "pcm",
      create: () => ({
        feedFrame: () => new Uint8Array([1]),
        flush: () => null,
        dispose: () => undefined,
      }),
    }

    registry.register(firstDefinition)
    expect(registry.has("pcm")).toBe(true)
    expect(registry.get("pcm")).toBe(firstDefinition)

    registry.register(secondDefinition)
    expect(registry.get("pcm")).toBe(secondDefinition)
  })

  it("reports available formats when lookup fails", () => {
    const registry = new ChunkedEncoderRegistry()
    registry.register({
      format: "pcm",
      create: () => ({
        feedFrame: () => null,
        flush: () => null,
        dispose: () => undefined,
      }),
    })
    registry.register({
      format: "wav",
      create: () => ({
        feedFrame: () => null,
        flush: () => null,
        dispose: () => undefined,
      }),
    })

    expect(() => registry.get("mp3")).toThrow(
      'ChunkedEncoder for format "mp3" is not registered. Available formats: pcm, wav'
    )
  })

  it("reports an empty registry clearly", () => {
    expect(() => new ChunkedEncoderRegistry().get("pcm")).toThrow(
      'ChunkedEncoder for format "pcm" is not registered. Available formats: (none)'
    )
  })

  it("exports a shared default registry instance", () => {
    expect(defaultChunkedEncoderRegistry).toBeInstanceOf(ChunkedEncoderRegistry)
  })
})
