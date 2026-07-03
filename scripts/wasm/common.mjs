/**
 * Common utilities for WASM build scripts
 */
import { createHash } from "crypto"
import { createWriteStream } from "fs"
import { mkdir, readFile } from "fs/promises"
import { pipeline } from "stream/promises"
import { spawn } from "child_process"
import { dirname } from "path"

export const supportedWasmCodecs = ["opus", "flac", "aac", "amr", "mp3", "ac3"]

/**
 * Download a file from URL with SHA-256 verification
 * @param {string} url - Download URL
 * @param {string} outputPath - Local file path
 * @param expectedSha
 * @param shaType
 */
export async function downloadAndVerify(
  url,
  outputPath,
  expectedSha,
  shaType = "SHA-256"
) {
  console.log(`Downloading ${url}...`)

  await mkdir(dirname(outputPath), { recursive: true })

  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`)
  }

  const finalUrl = response.url || url
  const contentType = response.headers.get("content-type") || ""
  if (/text\/html/i.test(contentType)) {
    throw new Error(
      `Expected an archive but received HTML from ${finalUrl}. ` +
        `The upstream mirror or redirect target likely changed.`
    )
  }

  const fileStream = createWriteStream(outputPath)
  await pipeline(response.body, fileStream)

  console.log(`Verifying ${shaType}...`)
  if (shaType === "SHA-256") {
    await verifyExistingFileSha256(outputPath, expectedSha)
  } else {
    await verifyExistingFileSha1(outputPath, expectedSha)
  }

  console.log(`${shaType} verified`)
}

/**
 * Verify an existing file against an expected SHA-256 hash
 * @param {string} path - Local file path
 * @param {string} expectedSha256 - Expected SHA-256 hash (hex string)
 */
export async function verifyExistingFileSha256(path, expectedSha256) {
  const fileBuffer = await readFile(path)
  const hash = createHash("sha256").update(fileBuffer).digest("hex")

  if (hash !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for cached file!\n` +
        `  File:     ${path}\n` +
        `  Expected: ${expectedSha256}\n` +
        `  Got:      ${hash}`
    )
  }

  console.log(`SHA-256 verified: ${path}`)
}

/**
 * Verify an existing file against an expected SHA-1 hash
 * @param {string} path - Local file path
 * @param {string} expectedSha1 - Expected SHA-1 hash (hex string)
 */
export async function verifyExistingFileSha1(path, expectedSha1) {
  const fileBuffer = await readFile(path)
  const hash = createHash("sha1").update(fileBuffer).digest("hex")

  if (hash !== expectedSha1) {
    throw new Error(
      `SHA-1 mismatch for cached file!\n` +
        `  File:     ${path}\n` +
        `  Expected: ${expectedSha1}\n` +
        `  Got:      ${hash}`
    )
  }

  console.log(`SHA-1 verified: ${path}`)
}

/**
 * Execute a command with streaming output
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {object} options - Spawn options
 */
export async function execCommand(command, args, options = {}) {
  console.log(`Running: ${command} ${args.join(" ")}`)

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      ...options,
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`))
      } else {
        resolve()
      }
    })

    proc.on("error", (err) => {
      reject(err)
    })
  })
}

/**
 * Execute emconfigure
 */
export async function emconfigure(args, options = {}) {
  console.log(args, options)
  return execCommand("emconfigure", args, options)
}

/**
 * Execute emmake
 */
export async function emmake(args, options = {}) {
  console.log(args, options)
  return execCommand("emmake", args, options)
}

/**
 * Execute emcc
 */
export async function emcc(args, options = {}) {
  console.log(args, options)
  return execCommand("emcc", args, options)
}

/**
 * Get number of parallel build jobs
 */
export function getBuildJobs(envVar = "BUILD_JOBS") {
  const jobs = process.env[envVar] || "4"
  return parseInt(jobs, 10)
}

function parseSimdToggleValue(rawValue, sourceName) {
  const normalized = rawValue.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false
  }

  throw new Error(
    `Invalid ${sourceName} value: ${rawValue}. ` +
      `Expected one of 1/0/true/false/on/off.`
  )
}

export function getCodecSimdEnvName(codec) {
  return `AUDIO_RECORDER_WASM_SIMD_${codec.trim().toUpperCase()}`
}

export function createCodecSimdArgOptions(codecs = supportedWasmCodecs) {
  return Object.fromEntries(
    codecs.map((codec) => [
      `simd-${codec}`,
      {
        type: "string",
      },
    ])
  )
}

export function applyCodecSimdCliOverrides(
  values,
  codecs = supportedWasmCodecs
) {
  for (const codec of codecs) {
    const optionName = `simd-${codec}`
    const rawValue = values[optionName]
    if (rawValue === undefined) {
      continue
    }

    const enabled = parseSimdToggleValue(rawValue, `--${optionName}`)
    process.env[getCodecSimdEnvName(codec)] = enabled ? "1" : "0"
  }
}

export function resolveWasmSimdEnabled(codec, defaultValue) {
  const codecEnvName = getCodecSimdEnvName(codec)
  const codecRawValue = process.env[codecEnvName]
  if (codecRawValue !== undefined) {
    return parseSimdToggleValue(codecRawValue, codecEnvName)
  }

  const rawValue = process.env.AUDIO_RECORDER_WASM_SIMD
  if (rawValue === undefined) {
    return defaultValue
  }

  return parseSimdToggleValue(rawValue, "AUDIO_RECORDER_WASM_SIMD")
}

export function getWasmSimdFlags(codec, defaultValue) {
  return resolveWasmSimdEnabled(codec, defaultValue) ? ["-msimd128"] : []
}
