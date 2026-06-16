import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"

const packageJson = JSON.parse(await readFile("package.json", "utf8"))
const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/encoders/pcm/index.js",
  "dist/encoders/pcm/index.d.ts",
  "dist/encoders/wav/index.js",
  "dist/encoders/wav/index.d.ts",
  "dist/plugins/level-meter/index.js",
  "dist/plugins/level-meter/index.d.ts",
  "dist/storage/opfs/index.js",
  "dist/storage/opfs/index.d.ts",
  "dist/storage/indexeddb/index.js",
  "dist/storage/indexeddb/index.d.ts",
  "dist/plugins/streaming-export/index.js",
  "dist/plugins/streaming-export/index.d.ts",
]
const rootExport = packageJson.exports?.["."]
const pcmEncoderExport = packageJson.exports?.["./encoders/pcm"]
const wavEncoderExport = packageJson.exports?.["./encoders/wav"]
const levelMeterExport = packageJson.exports?.["./plugins/level-meter"]
const opfsExport = packageJson.exports?.["./storage/opfs"]
const indexedDbExport = packageJson.exports?.["./storage/indexeddb"]
const streamingExportExport = packageJson.exports?.["./plugins/streaming-export"]

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
  !pcmEncoderExport ||
  pcmEncoderExport.import !== "./dist/encoders/pcm/index.js" ||
  pcmEncoderExport.types !== "./dist/encoders/pcm/index.d.ts"
) {
  console.error(
    "The package.json PCM encoder export must match dist/encoders/pcm/index.js and dist/encoders/pcm/index.d.ts."
  )
  process.exit(1)
}

if (
  !wavEncoderExport ||
  wavEncoderExport.import !== "./dist/encoders/wav/index.js" ||
  wavEncoderExport.types !== "./dist/encoders/wav/index.d.ts"
) {
  console.error(
    "The package.json WAV encoder export must match dist/encoders/wav/index.js and dist/encoders/wav/index.d.ts."
  )
  process.exit(1)
}

if (
  !levelMeterExport ||
  levelMeterExport.import !== "./dist/plugins/level-meter/index.js" ||
  levelMeterExport.types !== "./dist/plugins/level-meter/index.d.ts"
) {
  console.error(
    "The package.json level-meter export must match dist/plugins/level-meter/index.js and dist/plugins/level-meter/index.d.ts."
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

if (
  !streamingExportExport ||
  streamingExportExport.import !== "./dist/plugins/streaming-export/index.js" ||
  streamingExportExport.types !== "./dist/plugins/streaming-export/index.d.ts"
) {
  console.error(
    "The package.json streaming-export export must match dist/plugins/streaming-export/index.js and dist/plugins/streaming-export/index.d.ts."
  )
  process.exit(1)
}

const missing = required.filter((item) => !existsSync(item))

if (missing.length > 0) {
  console.error(`Missing build outputs: ${missing.join(", ")}`)
  process.exit(1)
}

console.log("Export verification passed.")
