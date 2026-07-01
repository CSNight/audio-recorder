import { describe, expect, it } from "vitest"
import { pcmDecoderDefinition } from "@/codecs/base"

describe("pcmDecoderDefinition", () => {
  it("decodes interleaved int16 PCM into planar float32 data", async () => {
    const input = new Int16Array([0, 32767, 16384, -16384])

    const decoded = await pcmDecoderDefinition.decode({
      chunk: new Uint8Array(input.buffer.slice(0)),
      format: "pcm",
      sampleRate: 16000,
      channels: 2,
    })

    expect(decoded.sampleRate).toBe(16000)
    expect(decoded.channels).toBe(2)
    expect(Array.from(decoded.planar[0] ?? [])).toEqual([0, 0.5])
    expect(Array.from(decoded.planar[1] ?? [])).toEqual([32767 / 32768, -0.5])
  })

  it("falls back to mono 16k metadata when chunk metadata is absent", async () => {
    const input = new Int16Array([16384, -16384])

    const decoded = await pcmDecoderDefinition.decode({
      chunk: new Uint8Array(input.buffer.slice(0)),
      format: "pcm",
      sampleRate: 0,
      channels: 0,
    })

    expect(decoded.sampleRate).toBe(16000)
    expect(decoded.channels).toBe(1)
    expect(Array.from(decoded.planar[0] ?? [])).toEqual([0.5, -0.5])
  })
})
