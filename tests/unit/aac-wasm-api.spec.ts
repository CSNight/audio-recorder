import { afterEach, describe, expect, it, vi } from "vitest"
import { AacError } from "@/codecs/aac/types"

function createMockAacModule(overrides: Partial<any> = {}) {
  const HEAPF32 = new Float32Array(64)
  const HEAPU8 = new Uint8Array(64)
  let currentPacket: Uint8Array<ArrayBufferLike> = new Uint8Array(0)
  const packetQueue: Array<number | Uint8Array> = []

  const module = {
    HEAPF32,
    HEAPU8,
    _init_encoder: vi.fn(() => 11),
    _get_encoder_frame_size: vi.fn(() => 4),
    _get_encoder_extradata: vi.fn(() => 20),
    _get_encoder_extradata_size: vi.fn(() => 2),
    _get_encode_input_ptr: vi.fn(() => 4),
    _send_frame: vi.fn(() => 0),
    _receive_packet: vi.fn(() => {
      const next = packetQueue.shift()
      if (next === undefined) {
        currentPacket = new Uint8Array(0)
        return 0
      }
      if (typeof next === "number") {
        currentPacket = new Uint8Array(0)
        return next
      }
      currentPacket = next
      return next.length
    }),
    _flush_encoder_start: vi.fn(),
    _get_encoded_data: vi.fn(() => {
      if (currentPacket.length === 0) {
        return 0
      }
      HEAPU8.set(currentPacket, 8)
      return 8
    }),
    _close_encoder: vi.fn(),
    __queuePackets: (...packets: Array<number | Uint8Array>) => {
      packetQueue.splice(0, packetQueue.length, ...packets)
    },
    ...overrides,
  }

  HEAPU8.set([0x12, 0x10], 20)
  return module
}

afterEach(() => {
  vi.resetModules()
  vi.doUnmock("@/codecs/aac/libaac.wasm.mjs")
})

describe("aac-wasm-api", () => {
  it("preloads the module only once", async () => {
    const module = createMockAacModule()
    const createModule = vi.fn(async () => module)
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: createModule,
    }))

    const api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    await api.preloadAacModule()

    expect(createModule).toHaveBeenCalledTimes(1)
  })

  it("throws when creating an encoder before preload", async () => {
    const api = await import("@/codecs/aac/aac-wasm-api")

    expect(() =>
      api.createAacEncoder({ sampleRate: 48000, channels: 2 })
    ).toThrow("AAC WASM module is not loaded")
  })

  it("covers the AacError shape", () => {
    const error = new AacError("bad packet", -7, "encode")

    expect(error.name).toBe("AacError")
    expect(error.message).toBe("encode: bad packet")
    expect(error.code).toBe(-7)
    expect(error.operation).toBe("encode")
  })

  it("rejects encoder creation when init or frame metadata is invalid", async () => {
    const initFailModule = createMockAacModule({
      _init_encoder: vi.fn(() => 0),
    })
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => initFailModule),
    }))

    let api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    expect(() =>
      api.createAacEncoder({ sampleRate: 48000, channels: 1 })
    ).toThrow("Failed to initialize AAC encoder")

    vi.resetModules()
    const frameSizeModule = createMockAacModule({
      _get_encoder_frame_size: vi.fn(() => 0),
    })
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => frameSizeModule),
    }))
    api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    expect(() =>
      api.createAacEncoder({ sampleRate: 48000, channels: 1 })
    ).toThrow("Invalid AAC frame size")
    expect(frameSizeModule._close_encoder).toHaveBeenCalledWith(11)

    vi.resetModules()
    const ascModule = createMockAacModule({
      _get_encoder_extradata: vi.fn(() => 0),
    })
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => ascModule),
    }))
    api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    expect(() =>
      api.createAacEncoder({ sampleRate: 48000, channels: 1 })
    ).toThrow("AudioSpecificConfig")
  })

  it("encodes, drains packets, flushes, and frees idempotently", async () => {
    const module = createMockAacModule()
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))

    const api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    const encoder = api.createAacEncoder({
      sampleRate: 48000,
      channels: 2,
      bitrate: 192000,
    })

    module.__queuePackets(Uint8Array.from([1, 2, 3]), Uint8Array.from([4]))
    expect(
      encoder.encode(new Int16Array([0, 32767, -32768, 16384, 1, 2, 3, 4]))
    ).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([4])])
    expect(Array.from(module.HEAPF32.slice(1, 5))).toEqual([
      0,
      32767 / 32768,
      -1,
      0.5,
    ])

    module.__queuePackets(Uint8Array.from([9, 8]))
    expect(encoder.flush()).toEqual([new Uint8Array([9, 8])])
    expect(module._flush_encoder_start).toHaveBeenCalledWith(11)

    encoder.free()
    encoder.free()
    expect(module._close_encoder).toHaveBeenCalledTimes(1)
    expect(() => encoder.flush()).toThrow("AAC encoder has been freed")
  })

  it("clamps bitrate to the AAC frame limit before initializing the encoder", async () => {
    const module = createMockAacModule()
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))

    const api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    const encoder = api.createAacEncoder({
      sampleRate: 16000,
      channels: 1,
      bitrate: 128000,
    })

    expect(module._init_encoder).toHaveBeenCalledWith(1, 16000, 96000)
    expect(encoder.bitrate).toBe(96000)
  })

  it("validates encode input length and packet drain failures", async () => {
    let module = createMockAacModule()
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))

    let api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    let encoder = api.createAacEncoder({ sampleRate: 48000, channels: 1 })

    expect(() => encoder.encode(new Int16Array([1, 2, 3]))).toThrow(
      "expects 4 samples per frame"
    )

    vi.resetModules()
    module = createMockAacModule({
      _get_encode_input_ptr: vi.fn(() => 0),
    })
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))
    api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    encoder = api.createAacEncoder({ sampleRate: 48000, channels: 1 })
    expect(() => encoder.encode(new Int16Array([1, 2, 3, 4]))).toThrow(
      "failed to allocate input buffer"
    )

    vi.resetModules()
    module = createMockAacModule({
      _send_frame: vi.fn(() => -9),
    })
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))
    api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    encoder = api.createAacEncoder({ sampleRate: 48000, channels: 1 })
    expect(() => encoder.encode(new Int16Array([1, 2, 3, 4]))).toThrow(
      "failed to accept a frame"
    )

    vi.resetModules()
    module = createMockAacModule()
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))
    api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    encoder = api.createAacEncoder({ sampleRate: 48000, channels: 1 })
    module.__queuePackets(-5)
    expect(() => encoder.encode(new Int16Array([1, 2, 3, 4]))).toThrow(
      "packet drain failed"
    )

    vi.resetModules()
    module = createMockAacModule({
      _get_encoded_data: vi.fn(() => 0),
    })
    vi.doMock("@/codecs/aac/libaac.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))
    api = await import("@/codecs/aac/aac-wasm-api")
    await api.preloadAacModule()
    encoder = api.createAacEncoder({ sampleRate: 48000, channels: 1 })
    module.__queuePackets(Uint8Array.from([1]))
    expect(() => encoder.encode(new Int16Array([1, 2, 3, 4]))).toThrow(
      "empty packet pointer"
    )
  })
})
