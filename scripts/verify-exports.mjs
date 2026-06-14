import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"

const packageJson = JSON.parse(await readFile("package.json", "utf8"))
const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/storage/opfs/index.js",
  "dist/storage/opfs/index.d.ts",
  "dist/storage/indexeddb/index.js",
  "dist/storage/indexeddb/index.d.ts",
]
const rootExport = packageJson.exports?.["."]
const opfsExport = packageJson.exports?.["./storage/opfs"]
const indexedDbExport = packageJson.exports?.["./storage/indexeddb"]

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

if (
  !opfsExport ||
  opfsExport.import !== "./dist/storage/opfs/index.js" ||
  opfsExport.types !== "./dist/storage/opfs/index.d.ts"
) {
  console.error(
    "The package.json OPFS export must match dist/storage/opfs/index.js and dist/storage/opfs/index.d.ts."
  )
  process.exit(1)
}

if (
  !indexedDbExport ||
  indexedDbExport.import !== "./dist/storage/indexeddb/index.js" ||
  indexedDbExport.types !== "./dist/storage/indexeddb/index.d.ts"
) {
  console.error(
    "The package.json IndexedDB export must match dist/storage/indexeddb/index.js and dist/storage/indexeddb/index.d.ts."
  )
  process.exit(1)
}

const missing = required.filter((item) => !existsSync(item))

if (missing.length > 0) {
  console.error(`Missing build outputs: ${missing.join(", ")}`)
  process.exit(1)
}

console.log("Export verification passed.")
