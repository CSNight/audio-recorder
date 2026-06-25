import { describe, expect, it } from "vitest"
import { flacChunkedEncoderDefinition } from "@/codecs/flac/flac-chunked-encoder"

// ---- helpers ---------------------------------------------------------------

function mono(samples: number[]): Int16Array[] {
  return [new Int16Array(samples)]
}

function stereo(left: number[], right: number[]): Int16Array[] {
  return [new Int16Array(left), new Int16Array(right)]
}

// ---- definition shape ------------------------------------------------------

describe("flacChunkedEncoderDefinition", () => {
  it("has format = 'flac'", () => {
    expect(flacChunkedEncoderDefinition.format).toBe("flac")
  })

  it("create() returns an object with feedFrame, flush, dispose", () => {
    const enc = flacChunkedEncoderDefinition.create()
    expect(typeof enc.feedFrame).toBe("function")
    expect(typeof enc.flush).toBe("function")
    expect(typeof enc.dispose).toBe("function")
  })

  it("accepts options without throwing", () => {
    expect(() =>
      flacChunkedEncoderDefinition.create({
        bitsPerSample: 16,
        compressionLevel: 5,
      })
    ).not.toThrow()
  })
})

// ---- feedFrame — pre-init behavior -----------------------------------------

describe("flacChunkedEncoder — feedFrame before WASM init", () => {
  it("returns null on first frame (encoder not yet ready)", () => {
    const enc = flacChunkedEncoderDefinition.create()
    // WASM init is async; first frame always returns null
    const result = enc.feedFrame(1, 48000, mono([100, 200, 300]))
    expect(result).toBeNull()
  })

  it("returns null for empty frame regardless of init state", () => {
    const enc = flacChunkedEncoderDefinition.create()
    expect(enc.feedFrame(1, 48000, mono([]))).toBeNull()
  })

  it("returns null for stereo first frame (async init pending)", () => {
    const enc = flacChunkedEncoderDefinition.create()
    const result = enc.feedFrame(2, 44100, stereo([1, 2], [3, 4]))
    expect(result).toBeNull()
  })
})

// ---- flush — pre-init behavior ---------------------------------------------

describe("flacChunkedEncoder — flush before WASM init", () => {
  it("returns null when encoder was never initialized (no feedFrame)", () => {
    const enc = flacChunkedEncoderDefinition.create()
    expect(enc.flush()).toBeNull()
  })
})

// ---- dispose ---------------------------------------------------------------

describe("flacChunkedEncoder — dispose", () => {
  it("dispose() does not throw before any frames are fed", () => {
    const enc = flacChunkedEncoderDefinition.create()
    expect(() => enc.dispose()).not.toThrow()
  })

  it("dispose() does not throw after feeding frames", () => {
    const enc = flacChunkedEncoderDefinition.create()
    enc.feedFrame(1, 48000, mono([1, 2, 3]))
    expect(() => enc.dispose()).not.toThrow()
  })

  it("dispose() can be called multiple times without throwing", () => {
    const enc = flacChunkedEncoderDefinition.create()
    expect(() => {
      enc.dispose()
      enc.dispose()
    }).not.toThrow()
  })

  it("flush() returns null after dispose()", () => {
    const enc = flacChunkedEncoderDefinition.create()
    enc.dispose()
    expect(enc.flush()).toBeNull()
  })
})

// ---- options variants ------------------------------------------------------

describe("flacChunkedEncoder — options", () => {
  it("creates encoder with bitsPerSample 24", () => {
    expect(() =>
      flacChunkedEncoderDefinition.create({ bitsPerSample: 24 })
    ).not.toThrow()
  })

  it("creates encoder with compressionLevel 0 (fastest)", () => {
    expect(() =>
      flacChunkedEncoderDefinition.create({ compressionLevel: 0 })
    ).not.toThrow()
  })

  it("creates encoder with compressionLevel 8 (best)", () => {
    expect(() =>
      flacChunkedEncoderDefinition.create({ compressionLevel: 8 })
    ).not.toThrow()
  })

  it("creates encoder with no options (defaults)", () => {
    expect(() => flacChunkedEncoderDefinition.create({})).not.toThrow()
  })
})
