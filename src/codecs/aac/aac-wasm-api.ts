import type { AacEncoderHandle, AacEncoderOptions } from "./types"
import { AacError } from "./types"

type LibAacModule = {
  HEAPF32: Float32Array
  HEAPU8: Uint8Array
  _init_encoder(channels: number, sampleRate: number, bitrate: number): number
  _get_encoder_frame_size(ctx: number): number
  _get_encoder_extradata(ctx: number): number
  _get_encoder_extradata_size(ctx: number): number
  _get_encode_input_ptr(ctx: number, size: number): number
  _send_frame(ctx: number, pts: bigint): number
  _receive_packet(ctx: number): number
  _flush_encoder_start(ctx: number): void
  _get_encoded_data(ctx: number): number
  _close_encoder(ctx: number): void
}

let modulePromise: Promise<LibAacModule> | undefined
let moduleCache: LibAacModule | undefined

async function getModule(): Promise<LibAacModule> {
  if (!modulePromise) {
    // @ts-expect-error Emscripten single-file module is generated at build time.
    const createLibAacModule = (await import("./libaac.wasm.mjs")).default
    modulePromise = createLibAacModule().then((mod: LibAacModule) => {
      moduleCache = mod
      return mod
    })
  }

  return modulePromise!
}

export async function preloadAacModule(): Promise<void> {
  if (moduleCache) return
  await getModule()
}

function readAudioSpecificConfig(
  module: LibAacModule,
  encoderPtr: number
): Uint8Array {
  const extradataPtr = module._get_encoder_extradata(encoderPtr)
  const extradataSize = module._get_encoder_extradata_size(encoderPtr)

  if (!extradataPtr || extradataSize < 2) {
    throw new AacError(
      "AAC encoder did not expose a valid AudioSpecificConfig.",
      -1,
      "readAudioSpecificConfig"
    )
  }

  return module.HEAPU8.slice(extradataPtr, extradataPtr + extradataSize)
}

export function createAacEncoder(options: AacEncoderOptions): AacEncoderHandle {
  if (!moduleCache) {
    throw new Error(
      "AAC WASM module is not loaded. Call preloadAacModule() and await it before creating an encoder."
    )
  }

  const module = moduleCache
  const bitrate = options.bitrate ?? 128_000
  const encoderPtr = module._init_encoder(
    options.channels,
    options.sampleRate,
    bitrate
  )

  if (!encoderPtr) {
    throw new AacError("Failed to initialize AAC encoder.", -1, "create")
  }

  const frameSize = module._get_encoder_frame_size(encoderPtr)
  if (frameSize <= 0) {
    module._close_encoder(encoderPtr)
    throw new AacError(
      `Invalid AAC frame size: ${frameSize}.`,
      frameSize,
      "create"
    )
  }

  const audioSpecificConfig = readAudioSpecificConfig(module, encoderPtr)

  let freed = false
  let nextPts = 0n

  const assertLive = () => {
    if (freed) {
      throw new Error("AAC encoder has been freed.")
    }
  }

  const drainPackets = (operation: string): Uint8Array[] => {
    const packets: Uint8Array[] = []

    while (true) {
      const packetSize = module._receive_packet(encoderPtr)
      if (packetSize === 0) {
        break
      }

      if (packetSize < 0) {
        throw new AacError(
          `AAC encoder packet drain failed with code ${packetSize}.`,
          packetSize,
          operation
        )
      }

      const packetPtr = module._get_encoded_data(encoderPtr)
      if (!packetPtr) {
        throw new AacError(
          "AAC encoder returned an empty packet pointer.",
          -1,
          operation
        )
      }

      packets.push(module.HEAPU8.slice(packetPtr, packetPtr + packetSize))
    }

    return packets
  }

  return {
    sampleRate: options.sampleRate,
    channels: options.channels,
    bitrate,
    frameSize,
    audioSpecificConfig,

    encode(pcm) {
      assertLive()

      const expectedSamples = frameSize * options.channels
      if (pcm.length !== expectedSamples) {
        throw new RangeError(
          `AAC encoder expects ${expectedSamples} samples per frame, received ${pcm.length}.`
        )
      }

      const inputPtr = module._get_encode_input_ptr(encoderPtr, pcm.length * 4)
      if (!inputPtr) {
        throw new AacError(
          "AAC encoder failed to allocate input buffer.",
          -1,
          "encode"
        )
      }

      const heapOffset = inputPtr >> 2
      for (let i = 0; i < pcm.length; i++) {
        module.HEAPF32[heapOffset + i] = pcm[i]! / 32768
      }

      const result = module._send_frame(encoderPtr, nextPts)
      if (result < 0) {
        throw new AacError(
          `AAC encoder failed to accept a frame: ${result}.`,
          result,
          "encode"
        )
      }

      nextPts += BigInt(frameSize)
      return drainPackets("encode")
    },

    flush() {
      assertLive()
      module._flush_encoder_start(encoderPtr)
      return drainPackets("flush")
    },

    free() {
      if (freed) return
      module._close_encoder(encoderPtr)
      freed = true
    },
  }
}
