import type { AmrBandMode, AmrEncoderHandle, AmrEncoderOptions } from "./types"

type LibAmrModule = {
  HEAP16: Int16Array
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(ptr: number): void
}

type LibAmrNbModule = LibAmrModule & {
  _amrnb_encoder_create(): number
  _amrnb_encoder_destroy(ctx: number): void
  _amrnb_encode_frame(ctx: number, pcmPtr: number, mode: number): number
  _amrnb_get_output_ptr(): number
}

type LibAmrWbModule = LibAmrModule & {
  _amrwb_encoder_create(): number
  _amrwb_encoder_destroy(ctx: number): void
  _amrwb_encode_frame(ctx: number, pcmPtr: number, mode: number): number
  _amrwb_get_output_ptr(): number
}

const AMR_CONFIG = {
  nb: {
    sampleRate: 8000 as const,
    frameSize: 160 as const,
    mode: 7,
    header: "#!AMR\n",
    mimeType: "audio/amr",
  },
  wb: {
    sampleRate: 16000 as const,
    frameSize: 320 as const,
    mode: 8,
    header: "#!AMR-WB\n",
    mimeType: "audio/amr-wb",
  },
}

let amrNbModulePromise: Promise<LibAmrNbModule> | undefined
let amrNbModuleCache: LibAmrNbModule | undefined
let amrWbModulePromise: Promise<LibAmrWbModule> | undefined
let amrWbModuleCache: LibAmrWbModule | undefined

async function getAmrNbModule(): Promise<LibAmrNbModule> {
  if (!amrNbModulePromise) {
    // @ts-expect-error Emscripten single-file module is generated at build time.
    const createLibAmrNbModule = (await import("./libamrnb.wasm.mjs")).default
    amrNbModulePromise = createLibAmrNbModule().then((mod: LibAmrNbModule) => {
      amrNbModuleCache = mod
      return mod
    })
  }

  return amrNbModulePromise!
}

async function getAmrWbModule(): Promise<LibAmrWbModule> {
  if (!amrWbModulePromise) {
    // @ts-expect-error Emscripten single-file module is generated at build time.
    const createLibAmrWbModule = (await import("./libamrwb.wasm.mjs")).default
    amrWbModulePromise = createLibAmrWbModule().then((mod: LibAmrWbModule) => {
      amrWbModuleCache = mod
      return mod
    })
  }

  return amrWbModulePromise!
}

export async function preloadAmrModules(): Promise<void> {
  await Promise.all([getAmrNbModule(), getAmrWbModule()])
}

export function getAmrStreamHeader(bandMode: AmrBandMode): Uint8Array {
  return new TextEncoder().encode(AMR_CONFIG[bandMode].header)
}

export function getAmrTargetSampleRate(bandMode: AmrBandMode): 8000 | 16000 {
  return AMR_CONFIG[bandMode].sampleRate
}

export function getAmrMimeType(bandMode: AmrBandMode): string {
  return AMR_CONFIG[bandMode].mimeType
}

export function createAmrEncoder(
  options: AmrEncoderOptions = {}
): AmrEncoderHandle {
  const bandMode = options.bandMode ?? "nb"
  if (bandMode === "nb") {
    if (!amrNbModuleCache) {
      throw new Error(
        "AMR-NB WASM module is not loaded. Call preloadAmrModules() and await it before creating an encoder."
      )
    }

    const module = amrNbModuleCache
    const encoderPtr = module._amrnb_encoder_create()
    if (!encoderPtr) {
      throw new Error("Failed to initialize AMR-NB encoder.")
    }

    let pcmPtr = 0
    let pcmBytes = 0
    let freed = false

    const ensureBuffer = (requiredBytes: number) => {
      if (requiredBytes > pcmBytes) {
        if (pcmPtr) module._free(pcmPtr)
        pcmPtr = module._malloc(requiredBytes)
        pcmBytes = requiredBytes
      }
      return pcmPtr
    }

    return {
      bandMode,
      sampleRate: AMR_CONFIG.nb.sampleRate,
      frameSize: AMR_CONFIG.nb.frameSize,

      encode(frame) {
        if (freed) {
          throw new Error("AMR-NB encoder has been freed.")
        }

        if (frame.length !== AMR_CONFIG.nb.frameSize) {
          throw new RangeError(
            `AMR-NB expects ${AMR_CONFIG.nb.frameSize} mono samples per frame, received ${frame.length}.`
          )
        }

        const ptr = ensureBuffer(frame.byteLength)
        module.HEAP16.set(frame, ptr >> 1)
        const packetSize = module._amrnb_encode_frame(
          encoderPtr,
          ptr,
          AMR_CONFIG.nb.mode
        )

        if (packetSize <= 0) {
          throw new Error(`AMR-NB encode failed: ${packetSize}.`)
        }

        const packetPtr = module._amrnb_get_output_ptr()
        return module.HEAPU8.slice(packetPtr, packetPtr + packetSize)
      },

      free() {
        if (freed) return
        if (pcmPtr) module._free(pcmPtr)
        module._amrnb_encoder_destroy(encoderPtr)
        freed = true
      },
    }
  }

  if (!amrWbModuleCache) {
    throw new Error(
      "AMR-WB WASM module is not loaded. Call preloadAmrModules() and await it before creating an encoder."
    )
  }

  const module = amrWbModuleCache
  const encoderPtr = module._amrwb_encoder_create()
  if (!encoderPtr) {
    throw new Error("Failed to initialize AMR-WB encoder.")
  }

  let pcmPtr = 0
  let pcmBytes = 0
  let freed = false

  const ensureBuffer = (requiredBytes: number) => {
    if (requiredBytes > pcmBytes) {
      if (pcmPtr) module._free(pcmPtr)
      pcmPtr = module._malloc(requiredBytes)
      pcmBytes = requiredBytes
    }
    return pcmPtr
  }

  return {
    bandMode,
    sampleRate: AMR_CONFIG.wb.sampleRate,
    frameSize: AMR_CONFIG.wb.frameSize,

    encode(frame) {
      if (freed) {
        throw new Error("AMR-WB encoder has been freed.")
      }

      if (frame.length !== AMR_CONFIG.wb.frameSize) {
        throw new RangeError(
          `AMR-WB expects ${AMR_CONFIG.wb.frameSize} mono samples per frame, received ${frame.length}.`
        )
      }

      const ptr = ensureBuffer(frame.byteLength)
      module.HEAP16.set(frame, ptr >> 1)
      const packetSize = module._amrwb_encode_frame(
        encoderPtr,
        ptr,
        AMR_CONFIG.wb.mode
      )

      if (packetSize <= 0) {
        throw new Error(`AMR-WB encode failed: ${packetSize}.`)
      }

      const packetPtr = module._amrwb_get_output_ptr()
      return module.HEAPU8.slice(packetPtr, packetPtr + packetSize)
    },

    free() {
      if (freed) return
      if (pcmPtr) module._free(pcmPtr)
      module._amrwb_encoder_destroy(encoderPtr)
      freed = true
    },
  }
}
