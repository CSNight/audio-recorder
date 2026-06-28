/**
 * Build libflac 1.4.3 WASM module
 */
import { dirname, join, resolve } from "path"
import { access, mkdir, rm } from "fs/promises"
import { fileURLToPath } from "url"
import {
  downloadAndVerify,
  emcc,
  emconfigure,
  emmake,
  getBuildJobs,
  getWasmSimdFlags,
  verifyExistingFileSha256,
} from "./common.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "../..")

// FLAC version and download info
const FLAC_VERSION = "1.4.3"
const FLAC_TARBALL = `flac-${FLAC_VERSION}.tar.xz`
const FLAC_URL = `https://downloads.xiph.org/releases/flac/${FLAC_TARBALL}`
const FLAC_SHA256 =
  "6c58e69cd22348f441b861092b825e591d0b822e106de6eb0ee4d05d27205b70"

// Paths
const CACHE_DIR = join(projectRoot, ".cache")
const SOURCE_DIR = join(CACHE_DIR, `flac-${FLAC_VERSION}`)
const BUILD_DIR = join(CACHE_DIR, `flac-${FLAC_VERSION}-build`)
const WRAPPER_C = join(projectRoot, "scripts/native/flac_wasm_wrapper.c")
const OUTPUT_PATH = join(projectRoot, "src/codecs/flac/libflac.wasm.mjs")

// All exported functions
const EXPORTED_FUNCTIONS = [
  "_free",
  "_malloc",
  // libflac native functions
  "_FLAC__stream_encoder_new",
  "_FLAC__stream_encoder_delete",
  "_FLAC__stream_encoder_set_channels",
  "_FLAC__stream_encoder_set_bits_per_sample",
  "_FLAC__stream_encoder_set_sample_rate",
  "_FLAC__stream_encoder_set_compression_level",
  "_FLAC__stream_encoder_set_total_samples_estimate",
  "_FLAC__stream_encoder_set_streamable_subset",
  "_FLAC__stream_encoder_process_interleaved",
  "_FLAC__stream_encoder_finish",
  "_FLAC__stream_encoder_get_state",
  // flac_wasm_wrapper.c custom functions (for write callback handling)
  "_fc_init_encoder",
  "_fc_get_output_ptr",
  "_fc_get_output_size",
  "_fc_reset_output",
]

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const SIMD_FLAGS = getWasmSimdFlags("flac", true)

const COMPILE_ENV = {
  ...process.env,
  CFLAGS: ["-DNDEBUG", "-O3", "-flto", ...SIMD_FLAGS].join(" "),
  CXXFLAGS: ["-DNDEBUG", "-O3", "-flto", ...SIMD_FLAGS].join(" "),
  LDFLAGS: "-O3 -flto",
}

export async function buildFlac() {
  console.log(`Building libflac ${FLAC_VERSION} WASM module...`)

  // Create directories
  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir(dirname(OUTPUT_PATH), { recursive: true })

  // Download and extract source if not present
  if (!(await exists(join(SOURCE_DIR, "configure")))) {
    const tarballPath = join(CACHE_DIR, FLAC_TARBALL)
    if (!(await exists(tarballPath))) {
      await downloadAndVerify(FLAC_URL, tarballPath, FLAC_SHA256)
    } else {
      console.log(`Source tarball exists, skipping download: ${tarballPath}`)
      await verifyExistingFileSha256(tarballPath, FLAC_SHA256)
    }

    console.log("Extracting tarball...")
    await import("child_process").then(({ execSync }) => {
      execSync(`tar -xJf "${tarballPath}" -C "${CACHE_DIR}"`, {
        stdio: "inherit",
      })
    })
  } else {
    console.log("Source directory exists, skipping download")
  }

  // Clean and create build directory
  await rm(BUILD_DIR, { recursive: true, force: true })
  await mkdir(BUILD_DIR, { recursive: true })

  // Configure with emscripten
  console.log("Configuring libflac...")
  await emconfigure(
    [
      join(SOURCE_DIR, "configure"),
      "--disable-cpplibs",
      "--disable-ogg",
      "--disable-programs",
      "--disable-examples",
      "--disable-shared",
      "--enable-static",
      "--host=wasm32-unknown-emscripten",
    ],
    { cwd: BUILD_DIR, env: COMPILE_ENV }
  )

  // Build libflac
  console.log("Building libflac...")
  const jobs = getBuildJobs("LIBFLAC_WASM_BUILD_JOBS")
  await emmake(["make", "-j", String(jobs)], { cwd: BUILD_DIR })

  // Link with emcc
  console.log("Linking WASM module...")
  await emcc(
    [
      "-O3",
      "-flto",
      ...SIMD_FLAGS,
      "-I",
      join(SOURCE_DIR, "include"),
      "-I",
      join(BUILD_DIR, "include"),
      WRAPPER_C,
      join(BUILD_DIR, "src/libFLAC/.libs/libFLAC.a"),
      "-o",
      OUTPUT_PATH,
      "-s",
      "FILESYSTEM=0",
      "-s",
      "MALLOC=emmalloc",
      "-s",
      "SUPPORT_LONGJMP=0",
      "-s",
      "ALLOW_MEMORY_GROWTH=1",
      "-s",
      "ASSERTIONS=0",
      "-s",
      "ENVIRONMENT=web,worker",
      "-s",
      "EXPORT_ES6=1",
      "-s",
      `EXPORTED_FUNCTIONS=${JSON.stringify(EXPORTED_FUNCTIONS)}`,
      "-s",
      'EXPORTED_RUNTIME_METHODS=["HEAP16","HEAP32","HEAPU8","UTF8ToString"]',
      "-s",
      "MODULARIZE=1",
      "-s",
      "EXPORT_NAME=createLibFlacModule",
      "-s",
      "SINGLE_FILE=1",
      "-s",
      "WASM_BIGINT=1",
    ],
    { cwd: projectRoot }
  )

  console.log(`✓ Built ${OUTPUT_PATH}`)
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildFlac().catch((err) => {
    console.error("Build failed:", err)
    process.exit(1)
  })
}
