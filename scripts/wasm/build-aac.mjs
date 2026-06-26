/**
 * Build FFmpeg AAC WASM module
 *
 * This follows Mediabunny's encoder-only bridge. ADTS, when needed, should be
 * assembled in the JS layer from the encoder extradata instead of via libavformat.
 */
import { join, resolve, dirname } from "path"
import { mkdir, rm, access } from "fs/promises"
import { fileURLToPath } from "url"
import {
  downloadAndVerify,
  emconfigure,
  emmake,
  emcc,
  getBuildJobs,
} from "./common.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "../..")

const FFMPEG_VERSION = "8.1.2"
const FFMPEG_TARBALL = `ffmpeg-${FFMPEG_VERSION}.tar.xz`
const FFMPEG_URL = `https://ffmpeg.org/releases/${FFMPEG_TARBALL}`
const FFMPEG_SHA256 =
  "464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c"

const CACHE_DIR = join(projectRoot, ".cache")
const SOURCE_DIR = join(CACHE_DIR, `ffmpeg-${FFMPEG_VERSION}`)
const BUILD_DIR = join(CACHE_DIR, `ffmpeg-${FFMPEG_VERSION}-build-aac`)
const WRAPPER_C = join(projectRoot, "scripts/native/aac_wasm_wrapper.c")
const OUTPUT_PATH = join(projectRoot, "src/codecs/aac/libaac.wasm.mjs")

const COMPILE_ENV = {
  ...process.env,
  CC: "emcc",
  CXX: "em++",
  AR: "emar",
  RANLIB: "emranlib",
  NM: "emnm",
  CFLAGS: "-DNDEBUG -O3 -flto -msimd128",
  CXXFLAGS: "-DNDEBUG -O3 -flto -msimd128",
  LDFLAGS: "-O3 -flto -msimd128",
}

const EXPORTED_FUNCTIONS = [
  "_malloc",
  "_free",
  "_init_encoder",
  "_get_encoder_frame_size",
  "_get_encoder_extradata",
  "_get_encoder_extradata_size",
  "_get_encode_input_ptr",
  "_send_frame",
  "_receive_packet",
  "_flush_encoder_start",
  "_reset_encoder",
  "_get_encoded_data",
  "_get_encoded_pts",
  "_get_encoded_duration",
  "_close_encoder",
]

const EXPORTED_RUNTIME_METHODS = ["HEAPU8", "HEAPF32"]

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function buildAac() {
  console.log(`Building FFmpeg AAC ${FFMPEG_VERSION} WASM module...`)

  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir(dirname(OUTPUT_PATH), { recursive: true })

  if (!(await exists(join(SOURCE_DIR, "configure")))) {
    const tarballPath = join(CACHE_DIR, FFMPEG_TARBALL)
    if (!(await exists(tarballPath))) {
      if (FFMPEG_SHA256.includes("TODO_UPDATE")) {
        throw new Error(
          "FFMPEG_SHA256 is not set. Update build-aac.mjs with the official release tarball SHA-256 before building."
        )
      }

      await downloadAndVerify(FFMPEG_URL, tarballPath, FFMPEG_SHA256)
    } else {
      console.log("Source tarball exists, skipping download")
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

  await rm(BUILD_DIR, { recursive: true, force: true })
  await mkdir(BUILD_DIR, { recursive: true })

  console.log("Configuring FFmpeg AAC...")
  await emconfigure(
    [
      join(SOURCE_DIR, "configure"),
      "--target-os=none",
      "--arch=x86_32",
      "--cpu=generic",
      "--enable-cross-compile",
      "--disable-asm",
      "--disable-x86asm",
      "--disable-inline-asm",
      "--disable-programs",
      "--disable-doc",
      "--disable-debug",
      "--disable-all",
      "--disable-everything",
      "--disable-autodetect",
      "--disable-pthreads",
      "--disable-runtime-cpudetect",
      "--disable-network",
      "--disable-avdevice",
      "--disable-avfilter",
      "--disable-swresample",
      "--disable-swscale",
      "--disable-gpl",
      "--enable-avcodec",
      "--enable-encoder=aac",
      "--cc=emcc",
      "--cxx=em++",
      "--ar=emar",
      "--nm=emnm",
      "--ranlib=emranlib",
      "--extra-cflags=-DNDEBUG -O3 -flto -msimd128",
      "--extra-ldflags=-O3 -flto -msimd128",
    ],
    { cwd: BUILD_DIR, env: COMPILE_ENV }
  )

  console.log("Building FFmpeg AAC...")
  const jobs = getBuildJobs("FFMPEG_AAC_WASM_BUILD_JOBS")
  await emmake(["make", "-j", String(jobs)], {
    cwd: BUILD_DIR,
    env: COMPILE_ENV,
  })

  console.log("Linking WASM module...")
  await emcc(
    [
      "-O3",
      "-flto",
      "-msimd128",
      "-I",
      SOURCE_DIR,
      "-I",
      BUILD_DIR,
      WRAPPER_C,
      join(BUILD_DIR, "libavcodec/libavcodec.a"),
      join(BUILD_DIR, "libavutil/libavutil.a"),
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
      "EXPORT_NAME=createLibAacModule",
      "-s",
      "SINGLE_FILE=1",
      "-s",
      "WASM_BIGINT=1",
    ],
    { cwd: projectRoot }
  )

  console.log(`✓ Built ${OUTPUT_PATH}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildAac().catch((err) => {
    console.error("Build failed:", err)
    process.exit(1)
  })
}
