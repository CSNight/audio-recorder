/**
 * Build AMR-NB / AMR-WB WASM modules
 *
 * This script prepares a unified build pipeline for:
 * - opencore-amr 0.1.6 (AMR-NB)
 * - vo-amrwbenc 0.1.3 (AMR-WB)
 *
 * It only establishes the build layer and output contracts.
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
  verifyExistingFileSha1,
} from "./common.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "../..")

const OPENCORE_AMR_VERSION = "0.1.6"
const OPENCORE_AMR_TARBALL = `opencore-amr-${OPENCORE_AMR_VERSION}.tar.gz`
const OPENCORE_AMR_URL =
  `https://sourceforge.net/projects/opencore-amr/files/opencore-amr/` +
  `${OPENCORE_AMR_TARBALL}/download`
const OPENCORE_AMR_SHA1 = "3c2c618a5a38757a530034f80aa5356789589bcc"

const VO_AMRWBENC_VERSION = "0.1.3"
const VO_AMRWBENC_TARBALL = `vo-amrwbenc-${VO_AMRWBENC_VERSION}.tar.gz`
const VO_AMRWBENC_URL =
  `https://sourceforge.net/projects/opencore-amr/files/vo-amrwbenc/` +
  `${VO_AMRWBENC_TARBALL}/download`
const VO_AMRWBENC_SHA1 = "427a147a378d258614d5d470f1f222e249535be7"

const CACHE_DIR = join(projectRoot, ".cache")
const OPENCORE_SOURCE_DIR = join(
  CACHE_DIR,
  `opencore-amr-${OPENCORE_AMR_VERSION}`
)
const OPENCORE_BUILD_DIR = join(
  CACHE_DIR,
  `opencore-amr-${OPENCORE_AMR_VERSION}-build`
)
const VO_SOURCE_DIR = join(CACHE_DIR, `vo-amrwbenc-${VO_AMRWBENC_VERSION}`)
const VO_BUILD_DIR = join(CACHE_DIR, `vo-amrwbenc-${VO_AMRWBENC_VERSION}-build`)

const NB_WRAPPER_C = join(projectRoot, "scripts/native/amrnb_wasm_wrapper.c")
const WB_WRAPPER_C = join(projectRoot, "scripts/native/amrwb_wasm_wrapper.c")
const NB_OUTPUT_PATH = join(projectRoot, "src/codecs/amr/libamrnb.wasm.mjs")
const WB_OUTPUT_PATH = join(projectRoot, "src/codecs/amr/libamrwb.wasm.mjs")

const NB_EXPORTED_FUNCTIONS = [
  "_malloc",
  "_free",
  "_amrnb_encoder_create",
  "_amrnb_encoder_destroy",
  "_amrnb_encode_frame",
  "_amrnb_get_output_ptr",
  "_amrnb_get_output_size",
]

const WB_EXPORTED_FUNCTIONS = [
  "_malloc",
  "_free",
  "_amrwb_encoder_create",
  "_amrwb_encoder_destroy",
  "_amrwb_encode_frame",
  "_amrwb_get_output_ptr",
  "_amrwb_get_output_size",
]

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const COMPILE_ENV = {
  ...process.env,
  CFLAGS: "-DNDEBUG -O3 -flto -msimd128",
  CXXFLAGS: "-DNDEBUG -O3 -flto -msimd128",
  LDFLAGS: "-O3 -flto",
}

async function ensureTarballExtracted({
  sourceDir,
  tarballName,
  url,
  sha1,
  extractArgs,
}) {
  if (!(await exists(join(sourceDir, "configure")))) {
    const tarballPath = join(CACHE_DIR, tarballName)
    if (!(await exists(tarballPath))) {
      if (sha1.includes("TODO_UPDATE")) {
        throw new Error(
          `${tarballName} SHA-1 is not set. Update build-amr.mjs with the official release tarball SHA-1 before building.`
        )
      }

      await downloadAndVerify(url, tarballPath, sha1, "SHA-1")
    } else {
      console.log(`Source tarball exists, skipping download: ${tarballPath}`)
      await verifyExistingFileSha1(tarballPath, sha1)
    }

    console.log(`Extracting ${tarballName}...`)
    await import("child_process").then(({ execSync }) => {
      execSync(`tar ${extractArgs} "${tarballPath}" -C "${CACHE_DIR}"`, {
        stdio: "inherit",
      })
    })
  } else {
    console.log(`Source directory exists, skipping download: ${sourceDir}`)
  }
}

async function configureAutotools(sourceDir, buildDir, host) {
  await rm(buildDir, { recursive: true, force: true })
  await mkdir(buildDir, { recursive: true })

  await emconfigure(
    [
      join(sourceDir, "configure"),
      "--disable-shared",
      "--enable-static",
      `--host=${host}`,
    ],
    { cwd: buildDir, env: COMPILE_ENV }
  )
}

async function buildAmrNb() {
  console.log(`Building opencore-amr ${OPENCORE_AMR_VERSION} (AMR-NB)...`)

  await ensureTarballExtracted({
    sourceDir: OPENCORE_SOURCE_DIR,
    tarballName: OPENCORE_AMR_TARBALL,
    url: OPENCORE_AMR_URL,
    sha1: OPENCORE_AMR_SHA1,
    extractArgs: "-xzf",
  })

  await configureAutotools(
    OPENCORE_SOURCE_DIR,
    OPENCORE_BUILD_DIR,
    "wasm32-unknown-emscripten"
  )

  const jobs = getBuildJobs("AMR_WASM_BUILD_JOBS")
  await emmake(["make", "-j", String(jobs)], { cwd: OPENCORE_BUILD_DIR })

  await mkdir(dirname(NB_OUTPUT_PATH), { recursive: true })

  await emcc(
    [
      "-O3",
      "-flto",
      "-msimd128",
      "-I",
      join(OPENCORE_SOURCE_DIR, "amrnb"),
      "-I",
      OPENCORE_SOURCE_DIR,
      NB_WRAPPER_C,
      join(OPENCORE_BUILD_DIR, "amrnb/.libs/libopencore-amrnb.a"),
      "-o",
      NB_OUTPUT_PATH,
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
      `EXPORTED_FUNCTIONS=${JSON.stringify(NB_EXPORTED_FUNCTIONS)}`,
      "-s",
      'EXPORTED_RUNTIME_METHODS=["HEAP16","HEAPU8"]',
      "-s",
      "MODULARIZE=1",
      "-s",
      "EXPORT_NAME=createLibAmrNbModule",
      "-s",
      "SINGLE_FILE=1",
      "-s",
      "WASM_BIGINT=1",
    ],
    { cwd: projectRoot }
  )

  console.log(`✓ Built ${NB_OUTPUT_PATH}`)
}

async function buildAmrWb() {
  console.log(`Building vo-amrwbenc ${VO_AMRWBENC_VERSION} (AMR-WB)...`)

  await ensureTarballExtracted({
    sourceDir: VO_SOURCE_DIR,
    tarballName: VO_AMRWBENC_TARBALL,
    url: VO_AMRWBENC_URL,
    sha1: VO_AMRWBENC_SHA1,
    extractArgs: "-xzf",
  })

  await configureAutotools(
    VO_SOURCE_DIR,
    VO_BUILD_DIR,
    "none"
  )

  const jobs = getBuildJobs("AMR_WASM_BUILD_JOBS")
  await emmake(["make", "-j", String(jobs)], { cwd: VO_BUILD_DIR })

  await mkdir(dirname(WB_OUTPUT_PATH), { recursive: true })

  await emcc(
    [
      "-O3",
      "-flto",
      "-msimd128",
      "-I",
      VO_SOURCE_DIR,
      WB_WRAPPER_C,
      join(VO_BUILD_DIR, ".libs/libvo-amrwbenc.a"),
      "-o",
      WB_OUTPUT_PATH,
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
      `EXPORTED_FUNCTIONS=${JSON.stringify(WB_EXPORTED_FUNCTIONS)}`,
      "-s",
      'EXPORTED_RUNTIME_METHODS=["HEAP16","HEAPU8"]',
      "-s",
      "MODULARIZE=1",
      "-s",
      "EXPORT_NAME=createLibAmrWbModule",
      "-s",
      "SINGLE_FILE=1",
      "-s",
      "WASM_BIGINT=1",
    ],
    { cwd: projectRoot }
  )

  console.log(`✓ Built ${WB_OUTPUT_PATH}`)
}

export async function buildAmr() {
  await mkdir(CACHE_DIR, { recursive: true })
  await buildAmrNb()
  await buildAmrWb()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildAmr().catch((err) => {
    console.error("Build failed:", err)
    process.exit(1)
  })
}
