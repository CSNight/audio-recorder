import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"

const packageJson = JSON.parse(await readFile("package.json", "utf8"))
const required = ["dist/index.js", "dist/index.d.ts"]
const rootExport = packageJson.exports?.["."]

if (
  !rootExport ||
  rootExport.import !== "./dist/index.js" ||
  rootExport.types !== "./dist/index.d.ts"
) {
  console.error(
    "The package.json root export must match dist/index.js and dist/index.d.ts."
  )
  process.exit(1)
}

const missing = required.filter((item) => !existsSync(item))

if (missing.length > 0) {
  console.error(`Missing build outputs: ${missing.join(", ")}`)
  process.exit(1)
}

console.log("Export verification passed.")
