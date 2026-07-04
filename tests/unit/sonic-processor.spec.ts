import { describe, expect, it } from "vitest"
import {
  transformInterleavedBlock,
  transformInterleavedPcm,
} from "../../src/plugins/sonic-export/sonic-processor"

function createSinePcm(length: number, amplitude = 12_000): Int16Array {
  const output = new Int16Array(length)
  for (let index = 0; index < length; index += 1) {
    output[index] = Math.round(
      Math.sin((2 * Math.PI * index) / Math.max(1, length / 8)) * amplitude
    )
  }
  return output
}

describe("sonic-processor", () => {
  it("changes output duration for speed while preserving mono PCM shape", () => {
    const input = createSinePcm(3200)

    const faster = transformInterleavedBlock(input, 16_000, 1, { speed: 2 })
    const slower = transformInterleavedBlock(input, 16_000, 1, { speed: 0.5 })

    expect(faster.length).toBe(1600)
    expect(slower.length).toBe(6400)
  })

  it("scales stereo output length by frame count rather than raw sample count", () => {
    const mono = createSinePcm(3200)
    const stereo = new Int16Array(mono.length * 2)
    for (let index = 0; index < mono.length; index += 1) {
      stereo[index * 2] = mono[index] ?? 0
      stereo[index * 2 + 1] = -(mono[index] ?? 0)
    }

    const faster = transformInterleavedBlock(stereo, 16_000, 2, { speed: 2 })

    expect(faster.length).toBe(3200)
  })

  it("applies volume scaling to the transformed PCM", async () => {
    const input = new Int16Array([1000, -1000, 2000, -2000])
    const output = await transformInterleavedPcm(input, 16_000, 1, {
      volume: 0.5,
      blockMs: 100,
    })

    expect(Array.from(output)).toEqual([500, -500, 1000, -1000])
  })
})
