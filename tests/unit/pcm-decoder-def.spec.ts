import { describe, expect, it } from "vitest"
import { pcmDecoderDefinition } from "../../src/codecs/base"

function makeChunk(int16Data: number[], sampleRate = 16000, channels = 1) {
  const int16 = new Int16Array(int16Data)
  return {
    format: "pcm" as const,
    chunk: new Uint8Array(int16.buffer),
    sampleRate,
    channels,
  }
}

describe("pcmDecoderDefinition", () => {
  it("has format pcm", () => {
    expect(pcmDecoderDefinition.format).toBe("pcm")
  })

  it("decodes mono int16 PCM to float32 planar", async () => {
    // 0, 16384 => 0, 0.5
    const chunk = makeChunk([0, 16384], 44100, 1)
    const result = await pcmDecoderDefinition.decode(chunk)
    expect(result.sampleRate).toBe(44100)
    expect(result.channels).toBe(1)
    expect(result.planar).toHaveLength(1)
    expect(result.planar[0]![0]).toBeCloseTo(0, 5)
    expect(result.planar[0]![1]).toBeCloseTo(0.5, 2)
  })

  it("decodes stereo int16 PCM to float32 planar", async () => {
    // interleaved: L0, R0, L1, R1
    const chunk = makeChunk([16384, -16384, 8192, -8192], 16000, 2)
    const result = await pcmDecoderDefinition.decode(chunk)
    expect(result.channels).toBe(2)
    expect(result.planar).toHaveLength(2)
    expect(result.planar[0]![0]).toBeCloseTo(0.5, 2)
    expect(result.planar[1]![0]).toBeCloseTo(-0.5, 2)
  })

  it("defaults sampleRate to 16000 and channels to 1 when zero", async () => {
    const int16 = new Int16Array([0])
    const chunk = {
      format: "pcm" as const,
      chunk: new Uint8Array(int16.buffer),
      sampleRate: 0,
      channels: 0,
    }
    const result = await pcmDecoderDefinition.decode(chunk)
    expect(result.sampleRate).toBe(16000)
    expect(result.channels).toBe(1)
  })

  it("handles empty chunk and returns frameLength=1", async () => {
    const chunk = makeChunk([], 16000, 1)
    const result = await pcmDecoderDefinition.decode(chunk)
    expect(result.planar[0]!.length).toBe(1)
  })
})
