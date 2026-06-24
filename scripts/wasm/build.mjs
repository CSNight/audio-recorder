#!/usr/bin/env node
/**
 * Unified WASM build entry point
 * Usage:
 *   node build.mjs --codec=opus
 *   node build.mjs --codec=flac
 *   node build.mjs --codec=all
 */
import { parseArgs } from "util"

const { values } = parseArgs({
  options: {
    codec: {
      type: "string",
      default: "all",
    },
  },
})

const codec = values.codec.toLowerCase()

async function main() {
  if (codec === "opus" || codec === "all") {
    console.log("\n=== Building Opus WASM ===\n")
    const { buildOpus } = await import("./build-opus.mjs")
    await buildOpus()
  }

  if (codec === "flac" || codec === "all") {
    console.log("\n=== Building FLAC WASM ===\n")
    const { buildFlac } = await import("./build-flac.mjs")
    await buildFlac()
  }

  if (!["opus", "flac", "all"].includes(codec)) {
    console.error(`Unknown codec: ${codec}`)
    console.error(`Usage: node build.mjs --codec=opus|flac|all`)
    process.exit(1)
  }

  console.log("\n✓ Build complete")
}

main().catch((err) => {
  console.error("\n✗ Build failed:", err)
  process.exit(1)
})
