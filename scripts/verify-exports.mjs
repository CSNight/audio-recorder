import { existsSync } from "node:fs"

const required = ["dist/index.js"]
const missing = required.filter((item) => !existsSync(item))

if (missing.length > 0) {
  console.error(`Missing build outputs: ${missing.join(", ")}`)
  process.exit(1)
}

console.log("Export verification passed.")
