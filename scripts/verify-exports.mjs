import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"

const packageJson = JSON.parse(await readFile("package.json", "utf8"))
const packageExports = packageJson.exports

if (!packageExports || typeof packageExports !== "object") {
  console.error("package.json must define an exports object.")
  process.exit(1)
}

const failures = []
const required = []

for (const [subpath, exportEntry] of Object.entries(packageExports)) {
  if (!exportEntry || typeof exportEntry !== "object") {
    failures.push(`Export ${subpath} must define an object with import/types.`)
    continue
  }

  if (
    typeof exportEntry.import !== "string" ||
    !exportEntry.import.startsWith("./dist/")
  ) {
    failures.push(`Export ${subpath} must define an import path under ./dist/.`)
    continue
  }

  if (
    typeof exportEntry.types !== "string" ||
    !exportEntry.types.startsWith("./dist/")
  ) {
    failures.push(`Export ${subpath} must define a types path under ./dist/.`)
    continue
  }

  if (!exportEntry.import.endsWith(".js")) {
    failures.push(`Export ${subpath} import path must end with .js.`)
    continue
  }

  if (!exportEntry.types.endsWith(".d.ts")) {
    failures.push(`Export ${subpath} types path must end with .d.ts.`)
    continue
  }

  required.push(exportEntry.import.slice(2), exportEntry.types.slice(2))
}

if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}

const missing = required.filter((item) => !existsSync(item))

if (missing.length > 0) {
  console.error(`Missing build outputs: ${missing.join(", ")}`)
  process.exit(1)
}

console.log("Export verification passed.")
