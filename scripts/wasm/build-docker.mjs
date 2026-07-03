#!/usr/bin/env node
/**
 * Docker-backed WASM build entry point.
 *
 * This avoids requiring a local Emscripten toolchain on the host machine.
 *
 * Usage:
 *   node build-docker.mjs --codec=opus
 *   node build-docker.mjs --codec=flac,aac
 *   node build-docker.mjs --codec=amr --codec=opus
 *   node build-docker.mjs --codec=all
 *   node build-docker.mjs --codec=all --simd-flac=on --simd-opus=off
 */
import { parseArgs } from "util"
import { spawn } from "child_process"
import { mkdir } from "fs/promises"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"
import {
  applyCodecSimdCliOverrides,
  createCodecSimdArgOptions,
  getCodecSimdEnvName,
  supportedWasmCodecs,
} from "./common.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "../..")
const imageName = "csnight-audio-recorder-wasm"
const supportedCodecs = supportedWasmCodecs
const artifactPaths = {
  opus: ["src/codecs/opus/libopus.wasm.mjs"],
  flac: ["src/codecs/flac/libflac.wasm.mjs"],
  aac: ["src/codecs/aac/libaac.wasm.mjs"],
  amr: ["src/codecs/amr/libamrnb.wasm.mjs", "src/codecs/amr/libamrwb.wasm.mjs"],
  mp3: ["src/codecs/mp3/libmp3.wasm.mjs"],
  ac3: ["src/codecs/ac3/libac3.wasm.mjs"],
}

const { values } = parseArgs({
  options: {
    codec: {
      type: "string",
      multiple: true,
      default: ["all"],
    },
    ...createCodecSimdArgOptions(supportedCodecs),
  },
})

function parseCodecSelection(codecValues) {
  const rawValues = Array.isArray(codecValues) ? codecValues : [codecValues]
  if (rawValues.length === 0 || rawValues.every((value) => !value)) {
    return [...supportedCodecs]
  }

  const selections = rawValues
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  if (selections.includes("all")) {
    return [...supportedCodecs]
  }

  const invalid = selections.filter((value) => !supportedCodecs.includes(value))
  if (invalid.length > 0) {
    console.error(`Unknown codec selection: ${invalid.join(", ")}`)
    console.error(
      `Usage: node build-docker.mjs --codec=all|${supportedCodecs.join("|")}|comma-separated list`
    )
    process.exit(1)
  }

  return [...new Set(selections)]
}

const codecs = parseCodecSelection(values.codec)
const codecArg = codecs.join(",")
applyCodecSimdCliOverrides(values, supportedCodecs)

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    })

    child.on("error", rejectPromise)
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        rejectPromise(new Error(`${command} exited with code ${code}`))
      }
    })
  })
}

function runAndCapture(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = ""
    let stderr = ""
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      ...options,
    })

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", rejectPromise)
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout.trim())
      } else {
        rejectPromise(
          new Error(
            `${command} exited with code ${code}${
              stderr ? `\n${stderr.trim()}` : ""
            }`
          )
        )
      }
    })
  })
}

async function ensureHostDirs() {
  await mkdir(resolve(projectRoot, ".cache"), { recursive: true })
  await mkdir(resolve(projectRoot, "src/codecs/opus"), { recursive: true })
  await mkdir(resolve(projectRoot, "src/codecs/flac"), { recursive: true })
  await mkdir(resolve(projectRoot, "src/codecs/aac"), { recursive: true })
  await mkdir(resolve(projectRoot, "src/codecs/amr"), { recursive: true })
  await mkdir(resolve(projectRoot, "src/codecs/mp3"), { recursive: true })
  await mkdir(resolve(projectRoot, "src/codecs/ac3"), { recursive: true })
}

async function ensureDockerImage() {
  console.log("\n=== Building WASM Docker image ===\n")
  await run(
    "docker",
    ["build", "-f", "scripts/wasm/Dockerfile", "-t", imageName, "."],
    { cwd: projectRoot }
  )
}

function createContainerName() {
  const timestamp = Date.now()
  const suffix = Math.random().toString(36).slice(2, 8)
  return `csnight-audio-recorder-wasm-build-${timestamp}-${suffix}`
}

async function copyArtifactsFromContainer(containerName) {
  const selectedArtifactPaths = codecs.flatMap((codec) => artifactPaths[codec])

  for (const relativePath of selectedArtifactPaths) {
    const hostPath = resolve(projectRoot, relativePath)
    await run(
      "docker",
      ["cp", `${containerName}:/build/${relativePath}`, hostPath],
      {
        cwd: projectRoot,
      }
    )
  }
}

async function runDockerBuild() {
  await ensureHostDirs()
  await ensureDockerImage()
  const containerName = createContainerName()
  const dockerCreateArgs = ["create", "--name", containerName]

  if (process.env.AUDIO_RECORDER_WASM_SIMD !== undefined) {
    dockerCreateArgs.push(
      "-e",
      `AUDIO_RECORDER_WASM_SIMD=${process.env.AUDIO_RECORDER_WASM_SIMD}`
    )
  }

  for (const codec of supportedCodecs) {
    const envName = getCodecSimdEnvName(codec)
    if (process.env[envName] !== undefined) {
      dockerCreateArgs.push("-e", `${envName}=${process.env[envName]}`)
    }
  }

  dockerCreateArgs.push(imageName, `--codec=${codecArg}`)

  try {
    await runAndCapture("docker", dockerCreateArgs, { cwd: projectRoot })
    await run("docker", ["start", "-a", containerName], { cwd: projectRoot })
    await copyArtifactsFromContainer(containerName)
  } finally {
    await run("docker", ["rm", "-f", containerName], {
      cwd: projectRoot,
    }).catch(() => {})
  }
}

async function main() {
  await runDockerBuild()
}

main().catch((err) => {
  console.error("\nDocker WASM build failed:", err)
  process.exit(1)
})
