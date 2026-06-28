import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

function setupWorkerHandlerMock() {
  const handler = vi.fn()
  let resolver: ((format: string) => unknown) | undefined
  const createWorkerMessageHandler = vi.fn((value) => {
    resolver = value
    return handler
  })

  vi.doMock("@/workers/chunked-encoder-worker-core", () => ({
    createWorkerMessageHandler,
  }))

  return {
    handler,
    createWorkerMessageHandler,
    getResolver: () => resolver!,
  }
}

describe("codec worker entrypoints", () => {
  it("binds single-definition workers to self.onmessage and preloads when available", async () => {
    const cases = [
      {
        entry: "@/codecs/base/pcm-worker",
        module: "@/codecs/base/pcm-chunked-encoder",
        exportName: "pcmChunkedEncoderDefinition",
        format: "pcm",
        hasPreload: false,
      },
      {
        entry: "@/codecs/base/wav-worker",
        module: "@/codecs/base/wav-chunked-encoder",
        exportName: "wavChunkedEncoderDefinition",
        format: "wav",
        hasPreload: false,
      },
      {
        entry: "@/codecs/g711/g711-worker",
        module: "@/codecs/g711/g711-chunked-encoder",
        exportName: "g711ChunkedEncoderDefinition",
        format: "g711",
        hasPreload: false,
      },
      {
        entry: "@/codecs/mp3/mp3-worker",
        module: "@/codecs/mp3/mp3-chunked-encoder",
        exportName: "mp3ChunkedEncoderDefinition",
        format: "mp3",
        hasPreload: false,
      },
      {
        entry: "@/codecs/aac/aac-worker",
        module: "@/codecs/aac/aac-chunked-encoder",
        exportName: "aacChunkedEncoderDefinition",
        format: "aac",
        hasPreload: true,
      },
      {
        entry: "@/codecs/amr/amr-worker",
        module: "@/codecs/amr/amr-chunked-encoder",
        exportName: "amrChunkedEncoderDefinition",
        format: "amr",
        hasPreload: true,
      },
      {
        entry: "@/codecs/flac/flac-worker",
        module: "@/codecs/flac/flac-chunked-encoder",
        exportName: "flacChunkedEncoderDefinition",
        format: "flac",
        hasPreload: true,
      },
    ] as const

    for (const item of cases) {
      vi.resetModules()
      const { handler, createWorkerMessageHandler, getResolver } =
        setupWorkerHandlerMock()
      const definition: any = {
        format: item.format,
        ...(item.hasPreload ? { preload: vi.fn() } : {}),
      }

      vi.doMock(item.module, () => ({
        [item.exportName]: definition,
      }))
      vi.stubGlobal("self", {} as Worker)

      await import(item.entry)

      expect(createWorkerMessageHandler).toHaveBeenCalledTimes(1)
      expect((globalThis as any).self.onmessage).toBe(handler)
      expect(getResolver()("ignored")).toBe(definition)
      if (item.hasPreload) {
        expect(definition.preload).toHaveBeenCalledTimes(1)
      }
    }
  })

  it("binds the Opus worker to both definitions and routes by format", async () => {
    const { handler, createWorkerMessageHandler, getResolver } =
      setupWorkerHandlerMock()
    const oggDefinition: any = { format: "ogg", preload: vi.fn() }
    const webmDefinition: any = { format: "webm", preload: vi.fn() }

    vi.doMock("@/codecs/opus/opus-chunked-encoder", () => ({
      oggChunkedEncoderDefinition: oggDefinition,
      webmChunkedEncoderDefinition: webmDefinition,
    }))
    vi.stubGlobal("self", {} as Worker)

    await import("@/codecs/opus/opus-worker")

    expect(createWorkerMessageHandler).toHaveBeenCalledTimes(1)
    expect((globalThis as any).self.onmessage).toBe(handler)
    expect(oggDefinition.preload).toHaveBeenCalledTimes(1)
    expect(webmDefinition.preload).toHaveBeenCalledTimes(1)
    expect(getResolver()("ogg")).toBe(oggDefinition)
    expect(getResolver()("webm")).toBe(webmDefinition)
    expect(() => getResolver()("bad")).toThrow("Unknown Opus format")
  })
})
