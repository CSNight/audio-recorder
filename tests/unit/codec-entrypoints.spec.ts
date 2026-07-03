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

    vi.doMock("../../src/codecs/base/pcm-worker.ts?worker", () => ({
      default: pcmWorker,
    }))
    vi.doMock("../../src/codecs/base/wav-worker.ts?worker", () => ({
      default: wavWorker,
    }))
    vi.doMock("../../src/codecs/base/pcm-chunked-encoder", () => ({
      pcmStreamEncoder: pcmDefinition,
    }))
    vi.doMock("../../src/codecs/base/wav-chunked-encoder", () => ({
      wavStreamEncoder: wavDefinition,
    }))
    vi.doMock("../../src/codecs/base/pcm-snapshot-encoder", () => ({
      pcmExportEncoder: { type: "pcm" },
    }))
    vi.doMock("../../src/codecs/base/wav-snapshot-encoder", () => ({
      wavExportEncoder: { type: "wav" },
    }))

    const mod = await import("../../src/codecs/base")

    expect(mod.pcmStreamEncoder).toBe(pcmDefinition)
    expect(mod.wavStreamEncoder).toBe(wavDefinition)
    expect(pcmDefinition.workerFactory().tag).toBe("pcm")
    expect(wavDefinition.workerFactory().tag).toBe("wav")
    expect(pcmWorker).toHaveBeenCalledTimes(1)
    expect(wavWorker).toHaveBeenCalledTimes(1)
  })
})
