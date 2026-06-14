import { describe, expect, it } from "vitest"
import type { PcmBufferSnapshot } from "@/buffer/types"
import {
  createDefaultEncoderRegistry,
  EncoderRegistry,
} from "@/encoders/encoder-registry"

const snapshot: PcmBufferSnapshot = {
  sampleRate: 16_000,
  channels: 1,
  frameCount: 1,
  durationMs: 0.25,
  planar: [new Int16Array([0, 1000, -1000, 500])],
}

describe("EncoderRegistry", () => {
  it("exports built-in pcm and wav encoders through the registry", () => {
    const registry = createDefaultEncoderRegistry()

    const pcm = registry.export("pcm", snapshot, {})
    const wav = registry.export("wav", snapshot, {})

    expect(Array.from(pcm.data)).toEqual([0, 1000, -1000, 500])
    expect(wav.mimeType).toBe("audio/wav")
    expect(wav.arrayBuffer.byteLength).toBe(52)
  })

  it("rejects duplicate encoder registration", () => {
    const registry = new EncoderRegistry()

    registry.register({
      type: "pcm",
      export: () => "first",
    })

    expect(() =>
      registry.register({
        type: "pcm",
        export: () => "second",
      })
    ).toThrow('Recorder encoder "pcm" is already registered.')
  })

  it("rejects exports for unregistered encoder types", () => {
    const registry = new EncoderRegistry()

    expect(() => registry.export("mp3", snapshot, {})).toThrow(
      'Recorder encoder "mp3" is not registered.'
    )
  })
})
