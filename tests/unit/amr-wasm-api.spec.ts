import { afterEach, describe, expect, it, vi } from "vitest"

function createMockNbModule(overrides: Partial<any> = {}) {
  const HEAP16 = new Int16Array(256)
  const HEAPU8 = new Uint8Array(256)
  let mallocPtr = 32

  HEAPU8.set([1, 2, 3, 4], 96)

  return {
    HEAP16,
    HEAPU8,
    _malloc: vi.fn((size: number) => {
      const ptr = mallocPtr
      mallocPtr += size
      return ptr
    }),
    _free: vi.fn(),
    _amrnb_encoder_create: vi.fn(() => 5),
    _amrnb_encoder_destroy: vi.fn(),
    _amrnb_encode_frame: vi.fn(() => 3),
    _amrnb_get_output_ptr: vi.fn(() => 96),
    ...overrides,
  }
}

function createMockWbModule(overrides: Partial<any> = {}) {
  const HEAP16 = new Int16Array(512)
  const HEAPU8 = new Uint8Array(512)
  let mallocPtr = 64

  HEAPU8.set([8, 9, 10, 11], 160)

  return {
    HEAP16,
    HEAPU8,
    _malloc: vi.fn((size: number) => {
      const ptr = mallocPtr
      mallocPtr += size
      return ptr
    }),
    _free: vi.fn(),
    _amrwb_encoder_create: vi.fn(() => 7),
    _amrwb_encoder_destroy: vi.fn(),
    _amrwb_encode_frame: vi.fn(() => 4),
    _amrwb_get_output_ptr: vi.fn(() => 160),
    ...overrides,
  }
}

afterEach(() => {
  vi.resetModules()
  vi.doUnmock("@/codecs/amr/libamrnb.wasm.mjs")
  vi.doUnmock("@/codecs/amr/libamrwb.wasm.mjs")
})

describe("amr-wasm-api", () => {
  it("preloads both modules once and exposes metadata helpers", async () => {
    const nbModule = createMockNbModule()
    const wbModule = createMockWbModule()
    const createNb = vi.fn(async () => nbModule)
    const createWb = vi.fn(async () => wbModule)
    vi.doMock("@/codecs/amr/libamrnb.wasm.mjs", () => ({ default: createNb }))
    vi.doMock("@/codecs/amr/libamrwb.wasm.mjs", () => ({ default: createWb }))

    const api = await import("@/codecs/amr/amr-wasm-api")
    await api.preloadAmrModules()
    await api.preloadAmrModules()

    expect(createNb).toHaveBeenCalledTimes(1)
    expect(createWb).toHaveBeenCalledTimes(1)
    expect(new TextDecoder().decode(api.getAmrStreamHeader("nb"))).toBe(
      "#!AMR\n"
    )
    expect(new TextDecoder().decode(api.getAmrStreamHeader("wb"))).toBe(
      "#!AMR-WB\n"
    )
    expect(api.getAmrTargetSampleRate("nb")).toBe(8000)
    expect(api.getAmrTargetSampleRate("wb")).toBe(16000)
    expect(api.getAmrMimeType("nb")).toBe("audio/amr")
    expect(api.getAmrMimeType("wb")).toBe("audio/amr-wb")
  })

  it("throws when creating encoders before preload", async () => {
    const api = await import("@/codecs/amr/amr-wasm-api")

    expect(() => api.createAmrEncoder()).toThrow("AMR-NB WASM module is not loaded")
    expect(() => api.createAmrEncoder({ bandMode: "wb" })).toThrow(
      "AMR-WB WASM module is not loaded"
    )
  })

  it("encodes AMR-NB frames, reuses the malloc buffer, and frees idempotently", async () => {
    const nbModule = createMockNbModule()
    const wbModule = createMockWbModule()
    vi.doMock("@/codecs/amr/libamrnb.wasm.mjs", () => ({
      default: vi.fn(async () => nbModule),
    }))
    vi.doMock("@/codecs/amr/libamrwb.wasm.mjs", () => ({
      default: vi.fn(async () => wbModule),
    }))

    const api = await import("@/codecs/amr/amr-wasm-api")
    await api.preloadAmrModules()
    const encoder = api.createAmrEncoder()
    const frame = new Int16Array(160).fill(12)

    expect(encoder.encode(frame)).toEqual(new Uint8Array([1, 2, 3]))
    expect(encoder.encode(frame)).toEqual(new Uint8Array([1, 2, 3]))
    expect(nbModule._malloc).toHaveBeenCalledTimes(1)
    expect(nbModule._amrnb_encode_frame).toHaveBeenCalledWith(5, 32, 7)

    encoder.free()
    encoder.free()
    expect(nbModule._free).toHaveBeenCalledTimes(1)
    expect(nbModule._amrnb_encoder_destroy).toHaveBeenCalledTimes(1)
    expect(() => encoder.encode(frame)).toThrow("AMR-NB encoder has been freed")
  })

  it("validates AMR-NB creation and encode failures", async () => {
    let nbModule = createMockNbModule({
      _amrnb_encoder_create: vi.fn(() => 0),
    })
    let wbModule = createMockWbModule()
    vi.doMock("@/codecs/amr/libamrnb.wasm.mjs", () => ({
      default: vi.fn(async () => nbModule),
    }))
    vi.doMock("@/codecs/amr/libamrwb.wasm.mjs", () => ({
      default: vi.fn(async () => wbModule),
    }))

    let api = await import("@/codecs/amr/amr-wasm-api")
    await api.preloadAmrModules()
    expect(() => api.createAmrEncoder()).toThrow("Failed to initialize AMR-NB")

    vi.resetModules()
    nbModule = createMockNbModule({
      _amrnb_encode_frame: vi.fn(() => 0),
    })
    wbModule = createMockWbModule()
    vi.doMock("@/codecs/amr/libamrnb.wasm.mjs", () => ({
      default: vi.fn(async () => nbModule),
    }))
    vi.doMock("@/codecs/amr/libamrwb.wasm.mjs", () => ({
      default: vi.fn(async () => wbModule),
    }))
    api = await import("@/codecs/amr/amr-wasm-api")
    await api.preloadAmrModules()
    const encoder = api.createAmrEncoder()

    expect(() => encoder.encode(new Int16Array(159))).toThrow(
      "expects 160 mono samples"
    )
    expect(() => encoder.encode(new Int16Array(160))).toThrow("encode failed")
  })

  it("covers AMR-WB success and failure paths", async () => {
    let nbModule = createMockNbModule()
    let wbModule = createMockWbModule()
    vi.doMock("@/codecs/amr/libamrnb.wasm.mjs", () => ({
      default: vi.fn(async () => nbModule),
    }))
    vi.doMock("@/codecs/amr/libamrwb.wasm.mjs", () => ({
      default: vi.fn(async () => wbModule),
    }))

    let api = await import("@/codecs/amr/amr-wasm-api")
    await api.preloadAmrModules()
    let encoder = api.createAmrEncoder({ bandMode: "wb" })
    const frame = new Int16Array(320).fill(21)

    expect(encoder.encode(frame)).toEqual(new Uint8Array([8, 9, 10, 11]))
    expect(wbModule._amrwb_encode_frame).toHaveBeenCalledWith(7, 64, 8)
    encoder.free()
    expect(() => encoder.encode(frame)).toThrow("AMR-WB encoder has been freed")

    vi.resetModules()
    nbModule = createMockNbModule()
    wbModule = createMockWbModule({
      _amrwb_encoder_create: vi.fn(() => 0),
    })
    vi.doMock("@/codecs/amr/libamrnb.wasm.mjs", () => ({
      default: vi.fn(async () => nbModule),
    }))
    vi.doMock("@/codecs/amr/libamrwb.wasm.mjs", () => ({
      default: vi.fn(async () => wbModule),
    }))
    api = await import("@/codecs/amr/amr-wasm-api")
    await api.preloadAmrModules()
    expect(() => api.createAmrEncoder({ bandMode: "wb" })).toThrow(
      "Failed to initialize AMR-WB"
    )

    vi.resetModules()
    nbModule = createMockNbModule()
    wbModule = createMockWbModule({
      _amrwb_encode_frame: vi.fn(() => -2),
    })
    vi.doMock("@/codecs/amr/libamrnb.wasm.mjs", () => ({
      default: vi.fn(async () => nbModule),
    }))
    vi.doMock("@/codecs/amr/libamrwb.wasm.mjs", () => ({
      default: vi.fn(async () => wbModule),
    }))
    api = await import("@/codecs/amr/amr-wasm-api")
    await api.preloadAmrModules()
    encoder = api.createAmrEncoder({ bandMode: "wb" })

    expect(() => encoder.encode(new Int16Array(319))).toThrow(
      "expects 320 mono samples"
    )
    expect(() => encoder.encode(new Int16Array(320))).toThrow("encode failed")
  })
})
