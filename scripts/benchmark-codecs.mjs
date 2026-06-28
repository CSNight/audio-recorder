#!/usr/bin/env node
import { spawn } from "child_process"
import { writeFile } from "fs/promises"
import { parseArgs } from "util"

const supportedCodecs = ["pcm", "wav", "mp3", "flac", "opus", "aac", "amr"]
const wasmCodecs = new Set(["mp3", "flac", "opus", "aac", "amr"])
const supportedSimdModes = ["both", "on", "off"]

const { values } = parseArgs({
  options: {
    codec: {
      type: "string",
      multiple: true,
      default: ["all"],
    },
    simd: {
      type: "string",
      default: "both",
    },
    rounds: {
      type: "string",
      default: "5",
    },
    warmup: {
      type: "string",
      default: "1",
    },
    "audio-ms": {
      type: "string",
      default: "15000",
    },
    json: {
      type: "boolean",
      default: false,
    },
    "json-file": {
      type: "string",
    },
  },
})

function parseCodecSelection(codecValues) {
  const rawValues = Array.isArray(codecValues) ? codecValues : [codecValues]
  const selections = rawValues
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  if (selections.length === 0 || selections.includes("all")) {
    return [...supportedCodecs]
  }

  const invalid = selections.filter((value) => !supportedCodecs.includes(value))
  if (invalid.length > 0) {
    throw new Error(`Unknown codec selection: ${invalid.join(", ")}`)
  }

  return [...new Set(selections)]
}

function parseSimdModes(simdValue) {
  const normalized = simdValue.trim().toLowerCase()
  if (!supportedSimdModes.includes(normalized)) {
    throw new Error(
      `Unknown simd mode: ${simdValue}. Expected one of ${supportedSimdModes.join(", ")}.`
    )
  }

  if (normalized === "both") {
    return ["off", "on"]
  }

  return [normalized]
}

function getNpmInvocation() {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return {
      command: process.execPath,
      argsPrefix: [npmExecPath],
    }
  }

  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    argsPrefix: [],
  }
}

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      shell: false,
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with code ${code}`))
      }
    })
  })
}

function runCommandCapture(command, args, env) {
  return new Promise((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      shell: false,
    })

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(
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

function formatNumber(value, digits = 2) {
  return Number(value).toFixed(digits)
}

function printSummary(resultsByMode) {
  const modes = Object.keys(resultsByMode)

  for (const mode of modes) {
    console.log(`\n[${mode.toUpperCase()}]`)
    for (const entry of resultsByMode[mode].cases) {
      const parts = [
        entry.name,
        `avg=${formatNumber(entry.averageElapsedMs)}ms`,
        `rtf=${formatNumber(entry.realtimeFactor)}x`,
        `bytes=${Math.round(entry.averageOutputBytes)}`,
      ]

      if (typeof entry.inputFrameCount === "number") {
        parts.push(`frames=${entry.inputFrameCount}`)
      }

      console.log(parts.join("  "))
    }
  }

  if (resultsByMode.on && resultsByMode.off) {
    console.log("\n[SIMD SPEEDUP]")
    const offCases = new Map(
      resultsByMode.off.cases.map((entry) => [entry.name, entry])
    )

    for (const onEntry of resultsByMode.on.cases) {
      const offEntry = offCases.get(onEntry.name)
      if (!offEntry) continue

      const speedup = offEntry.averageElapsedMs / onEntry.averageElapsedMs
      console.log(
        `${onEntry.name.padEnd(7)}  speedup=${formatNumber(speedup, 3)}x  ` +
          `off=${formatNumber(offEntry.averageElapsedMs)}ms  ` +
          `on=${formatNumber(onEntry.averageElapsedMs)}ms`
      )
    }
  }
}

async function buildArtifacts(codecs, simdMode) {
  const env = { ...process.env }
  if (simdMode === "on") {
    env.AUDIO_RECORDER_WASM_SIMD = "1"
  } else if (simdMode === "off") {
    env.AUDIO_RECORDER_WASM_SIMD = "0"
  }

  const npmInvocation = getNpmInvocation()
  const selectedWasmCodecs = codecs.filter((codec) => wasmCodecs.has(codec))

  if (selectedWasmCodecs.length > 0) {
    console.log(`\n=== Building WASM (${simdMode}) ===\n`)
    await runCommand(
      npmInvocation.command,
      [
        ...npmInvocation.argsPrefix,
        "run",
        "build:wasm:select",
        "--",
        `--codec=${selectedWasmCodecs.join(",")}`,
      ],
      env
    )
  }

  console.log(`\n=== Building dist (${simdMode}) ===\n`)
  await runCommand(
    npmInvocation.command,
    [...npmInvocation.argsPrefix, "run", "build"],
    env
  )
}

async function runBenchmarks(codecs, simdMode, rounds, warmupRounds, audioMs) {
  const env = { ...process.env }
  const args = [
    "./scripts/benchmark-codecs-runner.mjs",
    `--codec=${codecs.join(",")}`,
    `--rounds=${rounds}`,
    `--warmup=${warmupRounds}`,
    `--audio-ms=${audioMs}`,
  ]

  const stdout = await runCommandCapture("node", args, env)
  const result = JSON.parse(stdout)
  result.simdMode = simdMode
  return result
}

async function main() {
  const codecs = parseCodecSelection(values.codec)
  const simdModes = parseSimdModes(values.simd)
  const rounds = parseInt(values.rounds, 10)
  const warmupRounds = parseInt(values.warmup, 10)
  const audioMs = parseInt(values["audio-ms"], 10)

  if (Number.isNaN(rounds) || rounds <= 0) {
    throw new Error(`Invalid rounds value: ${values.rounds}`)
  }
  if (Number.isNaN(warmupRounds) || warmupRounds < 0) {
    throw new Error(`Invalid warmup value: ${values.warmup}`)
  }
  if (Number.isNaN(audioMs) || audioMs <= 0) {
    throw new Error(`Invalid audio-ms value: ${values["audio-ms"]}`)
  }

  const resultsByMode = {}

  for (const simdMode of simdModes) {
    await buildArtifacts(codecs, simdMode)

    console.log(`\n=== Benchmarking (${simdMode}) ===\n`)
    resultsByMode[simdMode] = await runBenchmarks(
      codecs,
      simdMode,
      rounds,
      warmupRounds,
      audioMs
    )
  }

  if (values.json) {
    const jsonText = JSON.stringify(resultsByMode, null, 2)
    if (values["json-file"]) {
      await writeFile(values["json-file"], `${jsonText}\n`, "utf8")
    }
    process.stdout.write(`${jsonText}\n`)
    return
  }

  if (values["json-file"]) {
    await writeFile(
      values["json-file"],
      `${JSON.stringify(resultsByMode, null, 2)}\n`,
      "utf8"
    )
  }

  printSummary(resultsByMode)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
