import type {
  Ac3Codec,
  Ac3EncoderHandle,
  Ac3EncoderOptions,
  Ac3ExportOptions,
  Ac3SampleRate,
  ResolvedAc3EncoderOptions,
} from "./types"
import { Ac3Error } from "./types"
import { AC3_SAMPLE_RATES, EAC3_SAMPLE_RATES } from "./sample-rate"

type LibAc3Module = {
  HEAPF32: Float32Array
  HEAPU8: Uint8Array
  _init_encoder(
    codecId: number,
    channels: number,
    sampleRate: number,
    bitrate: number
  ): number
  _get_encoder_frame_size(ctx: number): number
  _get_encode_input_ptr(ctx: number, size: number): number
  _send_frame(ctx: number, pts: bigint): number
  _receive_packet(ctx: number): number
  _flush_encoder_start(ctx: number): void
  _get_encoded_data(ctx: number): number
  _close_encoder(ctx: number): void
}

const DEFAULT_BITRATE: Record<Ac3Codec, number> = {
  ac3: 384000,
  eac3: 192000,
}
const AC3_SAMPLE_RATE_SET = new Set<number>(AC3_SAMPLE_RATES)
const EAC3_SAMPLE_RATE_SET = new Set<number>(EAC3_SAMPLE_RATES)

let modulePromise: Promise<LibAc3Module> | undefined
let moduleCache: LibAc3Module | undefined

function codecToId(codec: Ac3Codec): number {
  return codec === "ac3" ? 0 : 1
}

function assertChannelCount(channels: number): void {
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new RangeError(
      `AC3 encoder expects channels to be an integer between 1 and 8, received ${channels}.`
    )
  }
}

function assertSampleRate(
  codec: Ac3Codec,
  sampleRate: number
): asserts sampleRate is Ac3SampleRate {
  const supportedSampleRates =
    codec === "ac3" ? AC3_SAMPLE_RATE_SET : EAC3_SAMPLE_RATE_SET

  if (!supportedSampleRates.has(sampleRate)) {
    throw new RangeError(
      `${codec.toUpperCase()} encoder does not support sampleRate ${sampleRate}.`
    )
  }
}

async function getModule(): Promise<LibAc3Module> {
  if (!modulePromise) {
    // @ts-expect-error Emscripten single-file module is generated at build time.
    const createLibAc3Module = (await import("./libac3.wasm.mjs")).default
    modulePromise = createLibAc3Module().then((mod: LibAc3Module) => {
      moduleCache = mod
      return mod
    })
  }

  return modulePromise!
}

export async function preloadAc3Module(): Promise<void> {
  if (moduleCache) return
  await getModule()
}

export function resolveAc3EncoderOptions(
  options: Ac3ExportOptions,
  sampleRate: number,
  channels: number
): ResolvedAc3EncoderOptions {
  const codec = options.codec ?? "ac3"
  const resolvedSampleRate = options.sampleRate ?? sampleRate
  assertChannelCount(channels)
  assertSampleRate(codec, resolvedSampleRate)

  const bitrate = options.bitrate ?? DEFAULT_BITRATE[codec]
  if (!Number.isInteger(bitrate) || bitrate <= 0) {
    throw new RangeError("bitrate must be a positive integer.")
  }

  return {
    codec,
    sampleRate: resolvedSampleRate,
    channels,
    bitrate,
  }
}

export function createAc3Encoder(
  options: Ac3EncoderOptions | ResolvedAc3EncoderOptions
): Ac3EncoderHandle {
  if (!moduleCache) {
    throw new Error(
      "AC3 WASM module is not loaded. Call preloadAc3Module() and await it before creating an encoder."
    )
  }

  const module = moduleCache
  const unresolvedOptions = {
    ...(options.codec !== undefined ? { codec: options.codec } : {}),
    ...(options.bitrate !== undefined ? { bitrate: options.bitrate } : {}),
    sampleRate: options.sampleRate,
  }
  const resolved = resolveAc3EncoderOptions(
    unresolvedOptions,
    options.sampleRate,
    options.channels
  )

  const encoderPtr = module._init_encoder(
    codecToId(resolved.codec),
    resolved.channels,
    resolved.sampleRate,
    resolved.bitrate
  )

  if (!encoderPtr) {
    throw new Ac3Error("Failed to initialize AC3 encoder.", -1, "create")
  }

  const frameSize = module._get_encoder_frame_size(encoderPtr)
  if (frameSize <= 0) {
    module._close_encoder(encoderPtr)
    throw new Ac3Error(
      `Invalid AC3 frame size: ${frameSize}.`,
      frameSize,
      "create"
    )
  }

  let freed = false
  let nextPts = 0n

  const assertLive = () => {
    if (freed) {
      throw new Error("AC3 encoder has been freed.")
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
        throw new Ac3Error(
          `AC3 encoder packet drain failed with code ${packetSize}.`,
          packetSize,
          operation
        )
      }

      const packetPtr = module._get_encoded_data(encoderPtr)
      if (!packetPtr) {
        throw new Ac3Error(
          "AC3 encoder returned an empty packet pointer.",
          -1,
          operation
        )
      }

      packets.push(module.HEAPU8.slice(packetPtr, packetPtr + packetSize))
    }

    return packets
  }

  return {
    codec: resolved.codec,
    sampleRate: resolved.sampleRate,
    channels: resolved.channels,
    bitrate: resolved.bitrate,
    frameSize,

    encode(pcm) {
      assertLive()

      const expectedSamples = frameSize * resolved.channels
      if (pcm.length !== expectedSamples) {
        throw new RangeError(
          `AC3 encoder expects ${expectedSamples} samples per frame, received ${pcm.length}.`
        )
      }

      const inputPtr = module._get_encode_input_ptr(encoderPtr, pcm.length * 4)
      if (!inputPtr) {
        throw new Ac3Error(
          "AC3 encoder failed to allocate input buffer.",
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
        throw new Ac3Error(
          `AC3 encoder failed to accept a frame: ${result}.`,
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
