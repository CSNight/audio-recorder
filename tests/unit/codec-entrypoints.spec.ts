import { afterEach, describe, expect, it, vi } from "vitest"

function makeWorkerCtor(tag: string) {
  return vi.fn(function MockWorker(this: { tag?: string }) {
    this.tag = tag
  })
}

afterEach(() => {
  vi.resetModules()
})

describe("codec entrypoints", () => {
  it("injects worker factories for PCM and WAV via the base entrypoint", async () => {
    const pcmDefinition: any = { format: "pcm" }
    const wavDefinition: any = { format: "wav" }
    const pcmWorker = makeWorkerCtor("pcm")
    const wavWorker = makeWorkerCtor("wav")

    vi.doMock("@/codecs/base/pcm-worker.ts?worker", () => ({
      default: pcmWorker,
    }))
    vi.doMock("@/codecs/base/wav-worker.ts?worker", () => ({
      default: wavWorker,
    }))
    vi.doMock("@/codecs/base/pcm-chunked-encoder", () => ({
      pcmChunkedEncoderDefinition: pcmDefinition,
    }))
    vi.doMock("@/codecs/base/wav-chunked-encoder", () => ({
      wavChunkedEncoderDefinition: wavDefinition,
    }))
    vi.doMock("@/codecs/base/pcm-snapshot-encoder", () => ({
      pcmSnapshotEncoderDefinition: { type: "pcm" },
    }))
    vi.doMock("@/codecs/base/wav-snapshot-encoder", () => ({
      wavSnapshotEncoderDefinition: { type: "wav" },
    }))

    const mod = await import("@/codecs/base")

    expect(mod.pcmChunkedEncoderDefinition).toBe(pcmDefinition)
    expect(mod.wavChunkedEncoderDefinition).toBe(wavDefinition)
    expect(pcmDefinition.workerFactory().tag).toBe("pcm")
    expect(wavDefinition.workerFactory().tag).toBe("wav")
    expect(pcmWorker).toHaveBeenCalledTimes(1)
    expect(wavWorker).toHaveBeenCalledTimes(1)
  })
})
