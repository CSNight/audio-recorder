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
  it("binds PCM/WAV workers to self.onmessage", async () => {
    const cases = [
      {
        entry: "@/codecs/base/pcm-worker",
        module: "@/codecs/base/pcm-chunked-encoder",
        exportName: "pcmStreamEncoder",
        format: "pcm",
      },
      {
        entry: "@/codecs/base/wav-worker",
        module: "@/codecs/base/wav-chunked-encoder",
        exportName: "wavStreamEncoder",
        format: "wav",
      },
    ] as const

    for (const item of cases) {
      vi.resetModules()
      const { handler, createWorkerMessageHandler, getResolver } =
        setupWorkerHandlerMock()
      const definition: any = {
        format: item.format,
      }

      vi.doMock(item.module, () => ({
        [item.exportName]: definition,
      }))
      vi.stubGlobal("self", {} as Worker)

      await import(item.entry)

      expect(createWorkerMessageHandler).toHaveBeenCalledTimes(1)
      expect((globalThis as any).self.onmessage).toBe(handler)
      expect(getResolver()("ignored")).toBe(definition)
    }
  })
})
