/**
 * FLAC WASM API wrapper
 *
 * Simplified encoder-only wrapper for libflac
 * Uses write callback collection pattern via flac_wasm_wrapper.c
 */

import type { FlacEncoderHandle, FlacEncoderOptions } from "./types"
import { FlacError } from "./types"

// This will be the WASM module type
type LibFlacModule = any // Will be properly typed in types.d.mts

// FLAC encoder state codes (FLAC__StreamEncoderState)
const FLAC__STREAM_ENCODER_OK = 0
const FLAC__STREAM_ENCODER_UNINITIALIZED = 1
const FLAC__STREAM_ENCODER_OGG_ERROR = 2
const FLAC__STREAM_ENCODER_VERIFY_DECODER_ERROR = 3
const FLAC__STREAM_ENCODER_VERIFY_MISMATCH_IN_AUDIO_DATA = 4
const FLAC__STREAM_ENCODER_CLIENT_ERROR = 5
const FLAC__STREAM_ENCODER_IO_ERROR = 6
const FLAC__STREAM_ENCODER_FRAMING_ERROR = 7
const FLAC__STREAM_ENCODER_MEMORY_ALLOCATION_ERROR = 8

// FLAC init status codes (FLAC__StreamEncoderInitStatus)
const FLAC__STREAM_ENCODER_INIT_STATUS_OK = 0
const FLAC__STREAM_ENCODER_INIT_STATUS_ENCODER_ERROR = 1
const FLAC__STREAM_ENCODER_INIT_STATUS_UNSUPPORTED_CONTAINER = 2
const FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_CALLBACKS = 3
const FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_NUMBER_OF_CHANNELS = 4
const FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_BITS_PER_SAMPLE = 5
const FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_SAMPLE_RATE = 6
const FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_BLOCK_SIZE = 7
const FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_MAX_LPC_ORDER = 8
const FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_QLP_COEFF_PRECISION = 9
const FLAC__STREAM_ENCODER_INIT_STATUS_BLOCK_SIZE_TOO_SMALL_FOR_LPC_ORDER = 10
const FLAC__STREAM_ENCODER_INIT_STATUS_NOT_STREAMABLE = 11
const FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_METADATA = 12
const FLAC__STREAM_ENCODER_INIT_STATUS_ALREADY_INITIALIZED = 13

let modulePromise: Promise<LibFlacModule> | undefined
let moduleCache: LibFlacModule | undefined

function toFlacTotalSamplesEstimate(totalSamples: number): bigint {
  if (!Number.isSafeInteger(totalSamples) || totalSamples < 0) {
    throw new FlacError(
      `Invalid FLAC totalSamplesEstimate: ${totalSamples}`,
      -1,
      "setTotalSamplesEstimate"
    )
  }

  return BigInt(totalSamples)
}

/**
 * Get or create the WASM module singleton
 */
async function getModule(): Promise<LibFlacModule> {
  if (!modulePromise) {
    // Dynamic import of the WASM module
    // @ts-expect-error - WASM module type
    const createLibFlacModule = (await import("./libflac.wasm.mjs")).default
    modulePromise = createLibFlacModule().then((m: LibFlacModule) => {
      moduleCache = m
      return m
    })
  }
  return modulePromise
}

/**
 * 预加载 FLAC WASM 模块（幂等）。
 * 在 plugin.setup() 中、或 SnapshotEncoderDefinition.preload 中调用。
 * 这是模块中唯一需要 await 的入口。
 */
export async function preloadFlacModule(): Promise<void> {
  if (moduleCache) return // 已加载完成，直接返回，无需等待任何 Promise
  await getModule()
}

/**
 * Get error message for FLAC encoder state
 */
function getEncoderStateMessage(state: number): string {
  const stateNames: Record<string, string> = {
    [FLAC__STREAM_ENCODER_OK]: "OK",
    [FLAC__STREAM_ENCODER_UNINITIALIZED]: "Uninitialized",
    [FLAC__STREAM_ENCODER_OGG_ERROR]: "OGG error",
    [FLAC__STREAM_ENCODER_VERIFY_DECODER_ERROR]: "Verify decoder error",
    [FLAC__STREAM_ENCODER_VERIFY_MISMATCH_IN_AUDIO_DATA]:
      "Verify mismatch in audio data",
    [FLAC__STREAM_ENCODER_CLIENT_ERROR]: "Client error",
    [FLAC__STREAM_ENCODER_IO_ERROR]: "IO error",
    [FLAC__STREAM_ENCODER_FRAMING_ERROR]: "Framing error",
    [FLAC__STREAM_ENCODER_MEMORY_ALLOCATION_ERROR]: "Memory allocation error",
  }
  return stateNames[state] ?? "Unknown error"
}

/**
 * Get error message for FLAC init status
 */
function getInitStatusMessage(status: number): string {
  const statusNames: Record<string, string> = {
    [FLAC__STREAM_ENCODER_INIT_STATUS_OK]: "OK",
    [FLAC__STREAM_ENCODER_INIT_STATUS_ENCODER_ERROR]: "Encoder error",
    [FLAC__STREAM_ENCODER_INIT_STATUS_UNSUPPORTED_CONTAINER]:
      "Unsupported container",
    [FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_CALLBACKS]: "Invalid callbacks",
    [FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_NUMBER_OF_CHANNELS]:
      "Invalid number of channels",
    [FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_BITS_PER_SAMPLE]:
      "Invalid bits per sample",
    [FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_SAMPLE_RATE]:
      "Invalid sample rate",
    [FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_BLOCK_SIZE]: "Invalid block size",
    [FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_MAX_LPC_ORDER]:
      "Invalid max LPC order",
    [FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_QLP_COEFF_PRECISION]:
      "Invalid QLP coeff precision",
    [FLAC__STREAM_ENCODER_INIT_STATUS_BLOCK_SIZE_TOO_SMALL_FOR_LPC_ORDER]:
      "Block size too small for LPC order",
    [FLAC__STREAM_ENCODER_INIT_STATUS_NOT_STREAMABLE]: "Not streamable",
    [FLAC__STREAM_ENCODER_INIT_STATUS_INVALID_METADATA]: "Invalid metadata",
    [FLAC__STREAM_ENCODER_INIT_STATUS_ALREADY_INITIALIZED]:
      "Already initialized",
  }
  return statusNames[status] ?? "Unknown error"
}

/**
 * Create FLAC encoder (synchronous — caller must have awaited preloadFlacModule() first)
 */
export function createFlacEncoder(
  options: FlacEncoderOptions
): FlacEncoderHandle {
  if (!moduleCache) {
    throw new Error(
      "FLAC WASM module is not loaded. Call preloadFlacModule() and await it before creating an encoder."
    )
  }
  const module = moduleCache

  const sampleRate = options.sampleRate
  const channels = options.channels
  const bitsPerSample = options.bitsPerSample ?? 16
  const compressionLevel = options.compressionLevel ?? 5

  // Create encoder
  const encoderPtr = module._FLAC__stream_encoder_new()
  if (!encoderPtr) {
    throw new FlacError("Failed to create FLAC encoder", -1, "createEncoder")
  }

  // Configure encoder
  module._FLAC__stream_encoder_set_channels(encoderPtr, channels)
  module._FLAC__stream_encoder_set_bits_per_sample(encoderPtr, bitsPerSample)
  module._FLAC__stream_encoder_set_sample_rate(encoderPtr, sampleRate)
  module._FLAC__stream_encoder_set_compression_level(
    encoderPtr,
    compressionLevel
  )

  // Set streamable subset (required for most sample rates)
  // Only disable if using non-standard sample rates
  const standardSampleRates = [
    8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400,
    192000,
  ]
  const isStandardRate = standardSampleRates.includes(sampleRate)
  module._FLAC__stream_encoder_set_streamable_subset(
    encoderPtr,
    isStandardRate ? 1 : 0
  )

  if (options.totalSamplesEstimate !== undefined) {
    module._FLAC__stream_encoder_set_total_samples_estimate(
      encoderPtr,
      toFlacTotalSamplesEstimate(options.totalSamplesEstimate)
    )
  }

  // Initialize encoder with custom write callback wrapper
  const initStatus = module._fc_init_encoder(encoderPtr)
  if (initStatus !== FLAC__STREAM_ENCODER_INIT_STATUS_OK) {
    module._FLAC__stream_encoder_delete(encoderPtr)
    throw new FlacError(
      getInitStatusMessage(initStatus),
      initStatus,
      "initEncoder"
    )
  }

  let freed = false

  const assertLive = () => {
    if (freed) {
      throw new Error("FLAC encoder has been freed")
    }
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,

    encode(pcm: Int16Array, samplesPerChannel: number): Uint8Array {
      assertLive()

      // FLAC__stream_encoder_process_interleaved expects FLAC__int32* (4 bytes/sample)
      const totalSamples = pcm.length
      const pcmPtr = module._malloc(totalSamples * 4)

      try {
        const heap32 = new Int32Array(
          module.HEAP32.buffer,
          pcmPtr,
          totalSamples
        )
        for (let i = 0; i < totalSamples; i++) heap32[i] = pcm[i]!

        const ok = module._FLAC__stream_encoder_process_interleaved(
          encoderPtr,
          pcmPtr,
          samplesPerChannel
        )

        if (!ok) {
          const state = module._FLAC__stream_encoder_get_state(encoderPtr)
          throw new FlacError(getEncoderStateMessage(state), state, "encode")
        }

        // Read accumulated output (may include FLAC header on first call)
        const outputPtr = module._fc_get_output_ptr()
        const outputSize = module._fc_get_output_size()
        const result =
          outputSize > 0
            ? module.HEAPU8.slice(outputPtr, outputPtr + outputSize)
            : new Uint8Array(0)

        // Reset AFTER reading so header written during init is captured
        module._fc_reset_output()
        return result
      } finally {
        module._free(pcmPtr)
      }
    },

    flush(): Uint8Array {
      assertLive()

      const ok = module._FLAC__stream_encoder_finish(encoderPtr)

      if (!ok) {
        const state = module._FLAC__stream_encoder_get_state(encoderPtr)
        throw new FlacError(getEncoderStateMessage(state), state, "flush")
      }

      const outputPtr = module._fc_get_output_ptr()
      const outputSize = module._fc_get_output_size()
      const result =
        outputSize > 0
          ? module.HEAPU8.slice(outputPtr, outputPtr + outputSize)
          : new Uint8Array(0)

      module._fc_reset_output()
      return result
    },

    free() {
      if (freed) return

      module._FLAC__stream_encoder_delete(encoderPtr)
      freed = true
    },
  }
}
