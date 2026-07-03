import type {
  Mp3ChannelMode,
  Mp3ExportOptions,
  Mp3RateMode,
  Mp3SampleRate,
  Mp3WasmEncoderHandle,
  ResolvedMp3EncoderOptions,
} from "./types"
import { MP3_SAMPLE_RATES } from "./sample-rate"

type LibMp3Module = {
  HEAP16: Int16Array
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(ptr: number): void
  _init_lame(
    channels: number,
    inputSampleRate: number,
    outputSampleRate: number,
    rateMode: number,
    bitrateKbps: number,
    vbrQuality: number,
    channelMode: number,
    quality: number
  ): number
  _encode_samples(
    ctx: number,
    leftPtr: number,
    rightPtr: number,
    sampleCount: number,
    outPtr: number,
    outSize: number
  ): number
  _flush_lame(ctx: number, outPtr: number, outSize: number): number
  _close_lame(ctx: number): void
}

let modulePromise: Promise<LibMp3Module> | undefined
let moduleCache: LibMp3Module | undefined
const MP3_SAMPLE_RATE_SET = new Set<number>(MP3_SAMPLE_RATES)

function getDefaultChannelMode(channels: number): Mp3ChannelMode {
  return channels > 1 ? "stereo" : "mono"
}

function assertSampleRate(
  sampleRate: number
): asserts sampleRate is Mp3SampleRate {
  if (!MP3_SAMPLE_RATE_SET.has(sampleRate)) {
    throw new RangeError(
      `MP3 encoder requires a standard sampleRate, received ${sampleRate}.`
    )
  }
}

function assertQualityRange(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 9) {
    throw new RangeError(`${name} must be an integer between 0 and 9.`)
  }
}

function toRateMode(mode: Mp3RateMode): number {
  switch (mode) {
    case "abr":
      return 1
    case "vbr":
      return 2
    case "cbr":
    default:
      return 0
  }
}

function toChannelMode(mode: Mp3ChannelMode): number {
  switch (mode) {
    case "mono":
      return 0
    case "joint-stereo":
      return 2
    case "stereo":
    default:
      return 1
  }
}

async function getModule(): Promise<LibMp3Module | undefined> {
  if (!modulePromise) {
    // @ts-expect-error Emscripten single-file module is generated at build time.
    const createLibMp3Module = (await import("./libmp3.wasm.mjs")).default
    modulePromise = createLibMp3Module().then((mod: LibMp3Module) => {
      moduleCache = mod
      return mod
    })
  }

  return modulePromise
}

/** 预热并缓存 MP3 WASM 模块，幂等；createMp3Encoder 调用前应先 await 本函数。 */
export async function preloadMp3Module(): Promise<void> {
  if (moduleCache) return
  await getModule()
}

export function resolveMp3EncoderOptions(
  options: Mp3ExportOptions,
  sampleRate: number,
  channels: number
): ResolvedMp3EncoderOptions {
  const resolvedSampleRate = options.sampleRate ?? sampleRate
  assertSampleRate(resolvedSampleRate)

  const mode = options.mode ?? "cbr"
  const bitrateKbps = options.bitrateKbps ?? 128
  const vbrQuality = options.vbrQuality ?? 4
  const quality = options.quality ?? 2
  const channelMode = options.channelMode ?? getDefaultChannelMode(channels)

  if (!Number.isInteger(bitrateKbps) || bitrateKbps <= 0) {
    throw new RangeError("bitrateKbps must be a positive integer.")
  }

  assertQualityRange("vbrQuality", vbrQuality)
  assertQualityRange("quality", quality)

  if (channels < 1 || channels > 2) {
    throw new RangeError(
      `MP3 encoder expects 1 or 2 channels after normalization, received ${channels}.`
    )
  }

  return {
    bitrateKbps,
    mode,
    vbrQuality,
    sampleRate: resolvedSampleRate,
    channelMode,
    quality,
  }
}

export function createMp3Encoder(
  options: ResolvedMp3EncoderOptions,
  channels: 1 | 2
): Mp3WasmEncoderHandle {
  if (!moduleCache) {
    throw new Error(
      "MP3 WASM module is not loaded. Call preloadMp3Module() and await it before creating an encoder."
    )
  }

  const module = moduleCache
  const encoderPtr = module._init_lame(
    channels,
    options.sampleRate,
    options.sampleRate,
    toRateMode(options.mode),
    options.bitrateKbps,
    options.vbrQuality,
    toChannelMode(options.channelMode),
    options.quality
  )

  if (!encoderPtr) {
    throw new Error("Failed to initialize MP3 encoder.")
  }

  let leftPtr = 0
  let rightPtr = 0
  let outputPtr = 0
  let inputCapacity = 0
  let outputCapacity = 0
  let freed = false

  const ensureInputCapacity = (sampleCount: number) => {
    if (sampleCount <= inputCapacity) {
      return
    }

    if (leftPtr) module._free(leftPtr)
    if (rightPtr) module._free(rightPtr)

    inputCapacity = sampleCount
    leftPtr = module._malloc(sampleCount * Int16Array.BYTES_PER_ELEMENT)
    rightPtr = module._malloc(sampleCount * Int16Array.BYTES_PER_ELEMENT)
  }

  const ensureOutputCapacity = (sampleCount: number) => {
    const required = Math.max(7200, Math.ceil(1.25 * sampleCount + 7200))
    if (required <= outputCapacity) {
      return
    }

    if (outputPtr) module._free(outputPtr)
    outputCapacity = required
    outputPtr = module._malloc(outputCapacity)
  }

  const assertLive = () => {
    if (freed) {
      throw new Error("MP3 encoder has been freed.")
    }
  }

  return {
    sampleRate: options.sampleRate,
    channels,

    encode(left, right, sampleCount) {
      assertLive()

      if (
        sampleCount < 0 ||
        sampleCount > left.length ||
        sampleCount > right.length
      ) {
        throw new RangeError("MP3 encoder received an invalid sampleCount.")
      }

      if (sampleCount === 0) {
        return new Uint8Array(0)
      }

      ensureInputCapacity(sampleCount)
      ensureOutputCapacity(sampleCount)

      module.HEAP16.set(left.subarray(0, sampleCount), leftPtr >> 1)
      module.HEAP16.set(right.subarray(0, sampleCount), rightPtr >> 1)

      const bytesWritten = module._encode_samples(
        encoderPtr,
        leftPtr,
        rightPtr,
        sampleCount,
        outputPtr,
        outputCapacity
      )

      if (bytesWritten < 0) {
        throw new Error(`MP3 encoder encode failed with code ${bytesWritten}.`)
      }

      return module.HEAPU8.slice(outputPtr, outputPtr + bytesWritten)
    },

    flush() {
      assertLive()
      ensureOutputCapacity(0)
      const bytesWritten = module._flush_lame(
        encoderPtr,
        outputPtr,
        outputCapacity
      )
      if (bytesWritten < 0) {
        throw new Error(`MP3 encoder flush failed with code ${bytesWritten}.`)
      }

      return module.HEAPU8.slice(outputPtr, outputPtr + bytesWritten)
    },

    free() {
      if (freed) return
      if (leftPtr) module._free(leftPtr)
      if (rightPtr) module._free(rightPtr)
      if (outputPtr) module._free(outputPtr)
      module._close_lame(encoderPtr)
      freed = true
    },
  }
}
