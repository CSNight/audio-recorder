/**
 * Build LAME MP3 WASM module.
 *
 * This script downloads the official LAME source tarball, builds
 * `libmp3lame.a` with Emscripten, and then links it with the local bridge
 * wrapper so the runtime does not depend on vendored Mediabunny artifacts.
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

const LAME_VERSION = "3.100"
const LAME_TARBALL = `lame-${LAME_VERSION}.tar.gz`
const LAME_URL =
  `https://sourceforge.net/projects/lame/files/lame/${LAME_VERSION}/` +
  `${LAME_TARBALL}/download`
const LAME_SHA256 =
  "ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e"

const CACHE_DIR = join(projectRoot, ".cache")
const SOURCE_DIR = join(CACHE_DIR, `lame-${LAME_VERSION}`)
const BUILD_DIR = join(CACHE_DIR, `lame-${LAME_VERSION}-build`)
const WRAPPER_C = join(projectRoot, "scripts/native/mp3_wasm_wrapper.c")
const OUTPUT_PATH = join(projectRoot, "src/codecs/mp3/libmp3.wasm.mjs")
const STATIC_LIBRARY_PATH = join(BUILD_DIR, "libmp3lame/.libs/libmp3lame.a")

const SIMD_FLAGS = getWasmSimdFlags("mp3", true)

const COMPILE_ENV = {
  ...process.env,
  CFLAGS: ["-DNDEBUG", "-DNO_STDIO", "-O3", "-flto", ...SIMD_FLAGS].join(" "),
  CXXFLAGS: ["-DNDEBUG", "-DNO_STDIO", "-O3", "-flto", ...SIMD_FLAGS].join(" "),
  LDFLAGS: ["-O3", "-flto", ...SIMD_FLAGS].join(" "),
}

const EXPORTED_FUNCTIONS = [
  "_malloc",
  "_free",
  "_init_lame",
  "_encode_samples",
  "_flush_lame",
  "_close_lame",
]

const EXPORTED_RUNTIME_METHODS = ["HEAP16", "HEAPU8"]

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function ensureSourceExtracted() {
  if (await exists(join(SOURCE_DIR, "configure"))) {
    console.log(`Source directory exists, skipping download: ${SOURCE_DIR}`)
    return
  }

  const tarballPath = join(CACHE_DIR, LAME_TARBALL)
  if (!(await exists(tarballPath))) {
    await downloadAndVerify(LAME_URL, tarballPath, LAME_SHA256)
  } else {
    console.log(`Source tarball exists, skipping download: ${tarballPath}`)
    await verifyExistingFileSha256(tarballPath, LAME_SHA256)
  }

  console.log("Extracting tarball...")
  await import("child_process").then(({ execSync }) => {
    execSync(`tar -xzf "${tarballPath}" -C "${CACHE_DIR}"`, {
      stdio: "inherit",
    })
  })
}

async function buildStaticLibrary() {
  await rm(BUILD_DIR, { recursive: true, force: true })
  await mkdir(BUILD_DIR, { recursive: true })

  console.log("Configuring LAME...")
  await emconfigure(
    [
      join(SOURCE_DIR, "configure"),
      "--disable-dependency-tracking",
      "--disable-shared",
      "--enable-static",
      "--disable-gtktest",
      "--disable-analyzer-hooks",
      "--disable-decoder",
      "--disable-frontend",
      "--host=i686-pc-none",
    ],
    { cwd: BUILD_DIR, env: COMPILE_ENV }
  )

  console.log("Building libmp3lame.a...")
  const jobs = getBuildJobs("LIBMP3_WASM_BUILD_JOBS")
  await emmake(["make", "-j", String(jobs)], {
    cwd: BUILD_DIR,
    env: COMPILE_ENV,
  })
}

export async function buildMp3() {
  console.log(`Building LAME ${LAME_VERSION} MP3 WASM module...`)

  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await ensureSourceExtracted()
  await buildStaticLibrary()

  console.log("Linking WASM module...")
  await emcc(
    [
      "-O3",
      "-flto",
      ...SIMD_FLAGS,
      "-I",
      join(projectRoot, "scripts/native"),
      WRAPPER_C,
      STATIC_LIBRARY_PATH,
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
      `EXPORTED_RUNTIME_METHODS=${JSON.stringify(EXPORTED_RUNTIME_METHODS)}`,
      "-s",
      "MODULARIZE=1",
      "-s",
      "EXPORT_NAME=createLibMp3Module",
      "-s",
      "SINGLE_FILE=1",
      "-s",
      "WASM_BIGINT=1",
    ],
    { cwd: projectRoot }
  )

  console.log(`? Built ${OUTPUT_PATH}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildMp3().catch((err) => {
    console.error("Build failed:", err)
    process.exit(1)
  })
}
