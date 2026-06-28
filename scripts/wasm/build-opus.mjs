/**
 * Build libopus 1.6.1 WASM module
 * Adapted from vendor/libopus-wasm/scripts/build-libopus-wasm.mjs
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

// Opus version and download info
const OPUS_VERSION = "1.6.1"
const OPUS_TARBALL = `opus-${OPUS_VERSION}.tar.gz`
const OPUS_URL = `https://downloads.xiph.org/releases/opus/${OPUS_TARBALL}`
const OPUS_SHA256 =
  "6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1"

// Paths
const CACHE_DIR = join(projectRoot, ".cache")
const SOURCE_DIR = join(CACHE_DIR, `opus-${OPUS_VERSION}`)
const BUILD_DIR = join(CACHE_DIR, `opus-${OPUS_VERSION}-build`)
const WRAPPER_C = join(projectRoot, "scripts/native/opus_wasm_wrapper.c")
const OUTPUT_PATH = join(projectRoot, "src/codecs/opus/libopus.wasm.mjs")

// Only keep symbols that are used by the public JS wrapper.
const EXPORTED_FUNCTIONS = [
  "_free",
  "_malloc",
  "_oc_create_decoder",
  "_oc_create_encoder",
  "_oc_decode",
  "_oc_decode_float",
  "_oc_destroy_decoder",
  "_oc_destroy_encoder",
  "_oc_encode",
  "_oc_encode_float",
  "_oc_encoder_ctl",
  "_oc_encoder_ctl_get_lookahead",
  "_oc_strerror",
]

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const SIMD_FLAGS = getWasmSimdFlags("opus", false)

const COMPILE_ENV = {
  ...process.env,
  CFLAGS: ["-DNDEBUG", "-O3", "-flto", ...SIMD_FLAGS].join(" "),
  CXXFLAGS: ["-DNDEBUG", "-O3", "-flto", ...SIMD_FLAGS].join(" "),
  LDFLAGS: "-O3 -flto",
}

export async function buildOpus() {
  console.log(`Building libopus ${OPUS_VERSION} WASM module...`)

  // Create directories
  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir(dirname(OUTPUT_PATH), { recursive: true })

  // Download and extract source if not present
  if (!(await exists(join(SOURCE_DIR, "configure")))) {
    const tarballPath = join(CACHE_DIR, OPUS_TARBALL)
    if (!(await exists(tarballPath))) {
      await downloadAndVerify(OPUS_URL, tarballPath, OPUS_SHA256)
    } else {
      console.log(`Source tarball exists, skipping download: ${tarballPath}`)
      await verifyExistingFileSha256(tarballPath, OPUS_SHA256)
    }

    console.log("Extracting tarball...")
    await import("child_process").then(({ execSync }) => {
      execSync(`tar -xzf "${tarballPath}" -C "${CACHE_DIR}"`, {
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
  console.log("Configuring libopus...")
  await emconfigure(
    [
      join(SOURCE_DIR, "configure"),
      "--disable-doc",
      "--disable-extra-programs",
      "--disable-shared",
      "--enable-static",
      "--host=wasm32-unknown-emscripten",
    ],
    { cwd: BUILD_DIR, env: COMPILE_ENV }
  )

  // Build libopus
  console.log("Building libopus...")
  const jobs = getBuildJobs("LIBOPUS_WASM_BUILD_JOBS")
  await emmake(["make", "-j", String(jobs)], { cwd: BUILD_DIR })

  // Link with emcc
  console.log("Linking WASM module...")
  await emcc(
    [
      "-O3",
      "-flto",
      ...SIMD_FLAGS,
      "-I",
      join(BUILD_DIR, "include"),
      "-I",
      join(SOURCE_DIR, "include"),
      WRAPPER_C,
      join(BUILD_DIR, ".libs/libopus.a"),
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
      "ENVIRONMENT=web,worker", // Remove 'node' for web-only
      "-s",
      "EXPORT_ES6=1",
      "-s",
      `EXPORTED_FUNCTIONS=${JSON.stringify(EXPORTED_FUNCTIONS)}`,
      "-s",
      'EXPORTED_RUNTIME_METHODS=["HEAP16","HEAP32","HEAPF32","HEAPU8","UTF8ToString"]',
      "-s",
      "MODULARIZE=1",
      "-s",
      "EXPORT_NAME=createLibopusModule",
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
  buildOpus().catch((err) => {
    console.error("Build failed:", err)
    process.exit(1)
  })
}
