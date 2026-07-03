import { afterEach, describe, expect, it, vi } from "vitest"
import { Ac3Error } from "../../src/codecs/ac3"

function createMockAc3Module(overrides: Partial<any> = {}) {
  const HEAPF32 = new Float32Array(64)
  const HEAPU8 = new Uint8Array(64)
  let currentPacket: Uint8Array = new Uint8Array(0)
  const packetQueue: Array<number | Uint8Array> = []

  return {
    HEAPF32,
    HEAPU8,
    _init_encoder: vi.fn(() => 17),
    _get_encoder_frame_size: vi.fn(() => 6),
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
}

afterEach(() => {
  vi.resetModules()
  vi.doUnmock("../../src/codecs/ac3/libac3.wasm.mjs")
})

describe("ac3-wasm-api", () => {
  it("preloads the module only once", async () => {
    const module = createMockAc3Module()
    const createModule = vi.fn(async () => module)
    vi.doMock("../../src/codecs/ac3/libac3.wasm.mjs", () => ({
      default: createModule,
    }))

    const api = await import("../../src/codecs/ac3/ac3-wasm-api")
    await api.preloadAc3Module()
    await api.preloadAc3Module()

    expect(createModule).toHaveBeenCalledTimes(1)
  })

  it("throws when creating an encoder before preload", async () => {
    const api = await import("../../src/codecs/ac3/ac3-wasm-api")

    expect(() =>
      api.createAc3Encoder({ codec: "ac3", sampleRate: 48000, channels: 2 })
    ).toThrow("AC3 WASM module is not loaded")
  })

  it("covers the Ac3Error shape", () => {
    const error = new Ac3Error("bad packet", -7, "encode")

    expect(error.name).toBe("Ac3Error")
    expect(error.message).toBe("encode: bad packet")
    expect(error.code).toBe(-7)
    expect(error.operation).toBe("encode")
  })

  it("validates sample rate, channel count, and bitrate", async () => {
    const api = await import("../../src/codecs/ac3/ac3-wasm-api")

    expect(() =>
      api.resolveAc3EncoderOptions({ codec: "ac3" }, 24000, 2)
    ).toThrow("does not support sampleRate 24000")
    expect(() =>
      api.resolveAc3EncoderOptions({ codec: "eac3" }, 48000, 0)
    ).toThrow("channels to be an integer between 1 and 8")
    expect(() =>
      api.resolveAc3EncoderOptions({ codec: "ac3", bitrate: 0 }, 48000, 2)
    ).toThrow("bitrate must be a positive integer")
  })

  it("rejects encoder creation when init or frame metadata is invalid", async () => {
    const initFailModule = createMockAc3Module({
      _init_encoder: vi.fn(() => 0),
    })
    vi.doMock("../../src/codecs/ac3/libac3.wasm.mjs", () => ({
      default: vi.fn(async () => initFailModule),
    }))

    let api = await import("../../src/codecs/ac3/ac3-wasm-api")
    await api.preloadAc3Module()
    expect(() =>
      api.createAc3Encoder({ codec: "ac3", sampleRate: 48000, channels: 2 })
    ).toThrow("Failed to initialize AC3 encoder")

    vi.resetModules()
    const frameSizeModule = createMockAc3Module({
      _get_encoder_frame_size: vi.fn(() => 0),
    })
    vi.doMock("../../src/codecs/ac3/libac3.wasm.mjs", () => ({
      default: vi.fn(async () => frameSizeModule),
    }))
    api = await import("../../src/codecs/ac3/ac3-wasm-api")
    await api.preloadAc3Module()
    expect(() =>
      api.createAc3Encoder({ codec: "ac3", sampleRate: 48000, channels: 2 })
    ).toThrow("Invalid AC3 frame size")
    expect(frameSizeModule._close_encoder).toHaveBeenCalledWith(17)
  })

  it("encodes, drains packets, flushes, and frees idempotently", async () => {
    const module = createMockAc3Module()
    vi.doMock("../../src/codecs/ac3/libac3.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))

    const api = await import("../../src/codecs/ac3/ac3-wasm-api")
    await api.preloadAc3Module()
    const encoder = api.createAc3Encoder({
      codec: "eac3",
      sampleRate: 24000,
      channels: 2,
      bitrate: 224000,
    })

    module.__queuePackets(Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5]))
    expect(
      encoder.encode(
        new Int16Array([0, 32767, -32768, 16384, 1, 2, 3, 4, 5, 6, 7, 8])
      )
    ).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])])
    expect(Array.from(module.HEAPF32.slice(1, 5))).toEqual([
      0,
      32767 / 32768,
      -1,
      0.5,
    ])

    module.__queuePackets(Uint8Array.from([9, 8]))
    expect(encoder.flush()).toEqual([new Uint8Array([9, 8])])
    expect(module._flush_encoder_start).toHaveBeenCalledWith(17)

    encoder.free()
    encoder.free()
    expect(module._close_encoder).toHaveBeenCalledTimes(1)
    expect(() => encoder.flush()).toThrow("AC3 encoder has been freed")
  })

  it("validates encode input length and packet drain failures", async () => {
    let module = createMockAc3Module()
    vi.doMock("../../src/codecs/ac3/libac3.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))

    let api = await import("../../src/codecs/ac3/ac3-wasm-api")
    await api.preloadAc3Module()
    let encoder = api.createAc3Encoder({
      codec: "ac3",
      sampleRate: 48000,
      channels: 1,
    })

    expect(() => encoder.encode(new Int16Array([1, 2, 3]))).toThrow(
      "expects 6 samples per frame"
    )

    vi.resetModules()
    module = createMockAc3Module({
      _get_encode_input_ptr: vi.fn(() => 0),
    })
    vi.doMock("../../src/codecs/ac3/libac3.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))
    api = await import("../../src/codecs/ac3/ac3-wasm-api")
    await api.preloadAc3Module()
    encoder = api.createAc3Encoder({
      codec: "ac3",
      sampleRate: 48000,
      channels: 1,
    })
    expect(() => encoder.encode(new Int16Array([1, 2, 3, 4, 5, 6]))).toThrow(
      "failed to allocate input buffer"
    )

    vi.resetModules()
    module = createMockAc3Module({
      _send_frame: vi.fn(() => -9),
    })
    vi.doMock("../../src/codecs/ac3/libac3.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))
    api = await import("../../src/codecs/ac3/ac3-wasm-api")
    await api.preloadAc3Module()
    encoder = api.createAc3Encoder({
      codec: "ac3",
      sampleRate: 48000,
      channels: 1,
    })
    expect(() => encoder.encode(new Int16Array([1, 2, 3, 4, 5, 6]))).toThrow(
      "failed to accept a frame"
    )

    vi.resetModules()
    module = createMockAc3Module()
    vi.doMock("../../src/codecs/ac3/libac3.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))
    api = await import("../../src/codecs/ac3/ac3-wasm-api")
    await api.preloadAc3Module()
    encoder = api.createAc3Encoder({
      codec: "ac3",
      sampleRate: 48000,
      channels: 1,
    })
    module.__queuePackets(-5)
    expect(() => encoder.encode(new Int16Array([1, 2, 3, 4, 5, 6]))).toThrow(
      "packet drain failed"
    )

    vi.resetModules()
    module = createMockAc3Module({
      _get_encoded_data: vi.fn(() => 0),
    })
    vi.doMock("../../src/codecs/ac3/libac3.wasm.mjs", () => ({
      default: vi.fn(async () => module),
    }))
    api = await import("../../src/codecs/ac3/ac3-wasm-api")
    await api.preloadAc3Module()
    encoder = api.createAc3Encoder({
      codec: "ac3",
      sampleRate: 48000,
      channels: 1,
    })
    module.__queuePackets(Uint8Array.from([1]))
    expect(() => encoder.encode(new Int16Array([1, 2, 3, 4, 5, 6]))).toThrow(
      "empty packet pointer"
    )
  })
})
