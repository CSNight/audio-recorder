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

    vi.doMock("@/codecs/base/pcm-worker.ts?worker&inline", () => ({
      default: pcmWorker,
    }))
    vi.doMock("@/codecs/base/wav-worker.ts?worker&inline", () => ({
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

  it("injects worker factories for single-definition codec entrypoints", async () => {
    const cases = [
      {
        entry: "@/codecs/g711",
        workerModule: "@/codecs/g711/g711-worker.ts?worker&inline",
        chunkedModule: "@/codecs/g711/g711-chunked-encoder",
        exportName: "g711ChunkedEncoderDefinition",
        snapshotModule: "@/codecs/g711/g711-snapshot-exporter",
        snapshotExport: "g711SnapshotEncoderDefinition",
        tag: "g711",
      },
      {
        entry: "@/codecs/mp3",
        workerModule: "@/codecs/mp3/mp3-worker.ts?worker&inline",
        chunkedModule: "@/codecs/mp3/mp3-chunked-encoder",
        exportName: "mp3ChunkedEncoderDefinition",
        snapshotModule: "@/codecs/mp3/mp3-snapshot-exporter",
        snapshotExport: "mp3SnapshotEncoderDefinition",
        tag: "mp3",
      },
      {
        entry: "@/codecs/aac",
        workerModule: "@/codecs/aac/aac-worker.ts?worker&inline",
        chunkedModule: "@/codecs/aac/aac-chunked-encoder",
        exportName: "aacChunkedEncoderDefinition",
        snapshotModule: "@/codecs/aac/aac-snapshot-exporter",
        snapshotExport: "aacSnapshotEncoderDefinition",
        tag: "aac",
      },
      {
        entry: "@/codecs/amr",
        workerModule: "@/codecs/amr/amr-worker.ts?worker&inline",
        chunkedModule: "@/codecs/amr/amr-chunked-encoder",
        exportName: "amrChunkedEncoderDefinition",
        snapshotModule: "@/codecs/amr/amr-snapshot-exporter",
        snapshotExport: "amrSnapshotEncoderDefinition",
        tag: "amr",
      },
      {
        entry: "@/codecs/flac",
        workerModule: "@/codecs/flac/flac-worker.ts?worker&inline",
        chunkedModule: "@/codecs/flac/flac-chunked-encoder",
        exportName: "flacChunkedEncoderDefinition",
        snapshotModule: "@/codecs/flac/flac-snapshot-exporter",
        snapshotExport: "flacSnapshotEncoderDefinition",
        tag: "flac",
      },
    ] as const

    for (const item of cases) {
      vi.resetModules()
      const definition: any = { format: item.tag }
      const workerCtor = makeWorkerCtor(item.tag)

      vi.doMock(item.workerModule, () => ({
        default: workerCtor,
      }))
      vi.doMock(item.chunkedModule, () => ({
        [item.exportName]: definition,
      }))
      vi.doMock(item.snapshotModule, () => ({
        [item.snapshotExport]: { type: item.tag },
      }))
      if (item.entry === "@/codecs/aac") {
        vi.doMock("@/codecs/aac/aac-wasm-api", () => ({
          createAacEncoder: vi.fn(),
        }))
      }
      if (item.entry === "@/codecs/amr") {
        vi.doMock("@/codecs/amr/amr-wasm-api", () => ({
          createAmrEncoder: vi.fn(),
        }))
      }
      if (item.entry === "@/codecs/flac") {
        vi.doMock("@/codecs/flac/flac-wasm-api", () => ({
          createFlacEncoder: vi.fn(),
        }))
      }

      const mod = await import(item.entry)
      expect(mod[item.exportName]).toBe(definition)
      expect(definition.workerFactory().tag).toBe(item.tag)
      expect(workerCtor).toHaveBeenCalledTimes(1)
    }
  })

  it("injects the shared worker factory for both Opus definitions", async () => {
    const oggDefinition: any = { format: "ogg" }
    const webmDefinition: any = { format: "webm" }
    const workerCtor = makeWorkerCtor("opus")

    vi.doMock("@/codecs/opus/opus-worker.ts?worker&inline", () => ({
      default: workerCtor,
    }))
    vi.doMock("@/codecs/opus/opus-chunked-encoder", () => ({
      oggChunkedEncoderDefinition: oggDefinition,
      webmChunkedEncoderDefinition: webmDefinition,
    }))
    vi.doMock("@/codecs/opus/opus-snapshot-exporter", () => ({
      oggSnapshotEncoderDefinition: { type: "ogg" },
      webmSnapshotEncoderDefinition: { type: "webm" },
    }))
    vi.doMock("@/codecs/opus/opus-wasm-api", () => ({
      createOpusEncoder: vi.fn(),
      createOpusDecoder: vi.fn(),
    }))

    const mod = await import("@/codecs/opus")

    expect(mod.oggChunkedEncoderDefinition).toBe(oggDefinition)
    expect(mod.webmChunkedEncoderDefinition).toBe(webmDefinition)
    expect(oggDefinition.workerFactory().tag).toBe("opus")
    expect(webmDefinition.workerFactory().tag).toBe("opus")
    expect(workerCtor).toHaveBeenCalledTimes(2)
  })
})
