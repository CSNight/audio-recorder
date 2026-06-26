#!/usr/bin/env node
/**
 * Unified WASM build entry point
 * Usage:
 *   node build.mjs --codec=opus
 *   node build.mjs --codec=flac,aac
 *   node build.mjs --codec=amr --codec=opus
 *   node build.mjs --codec=all
 */
import { parseArgs } from "util"

const supportedCodecs = ["opus", "flac", "aac", "amr"]

const { values } = parseArgs({
  options: {
    codec: {
      type: "string",
      multiple: true,
    },
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
      `Usage: node build.mjs --codec=all|${supportedCodecs.join("|")}|comma-separated list`
    )
    process.exit(1)
  }

  return [...new Set(selections)]
}

const codecs = parseCodecSelection(values.codec)

async function main() {
  if (codecs.includes("opus")) {
    console.log("\n=== Building Opus WASM ===\n")
    const { buildOpus } = await import("./build-opus.mjs")
    await buildOpus()
  }

  if (codecs.includes("flac")) {
    console.log("\n=== Building FLAC WASM ===\n")
    const { buildFlac } = await import("./build-flac.mjs")
    await buildFlac()
  }

  if (codecs.includes("aac")) {
    console.log("\n=== Building AAC WASM ===\n")
    const { buildAac } = await import("./build-aac.mjs")
    await buildAac()
  }

  if (codecs.includes("amr")) {
    console.log("\n=== Building AMR WASM ===\n")
    const { buildAmr } = await import("./build-amr.mjs")
    await buildAmr()
  }

  console.log("\n✓ Build complete")
}

main().catch((err) => {
  console.error("\n✗ Build failed:", err)
  process.exit(1)
})
