import { readdir, readFile, writeFile } from "node:fs/promises"
import { relative, dirname, join, posix } from "node:path"

const distRoot = "dist"
const specifierPattern = /(["'])@\/([^"'`]+)\1/g

async function collectDeclarationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectDeclarationFiles(fullPath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith(".d.ts")) {
      files.push(fullPath)
    }
  }

  return files
}

function normalizeModuleSpecifier(currentFile, targetFromAlias) {
  const currentDirectory = dirname(currentFile)
  const absoluteTarget = join(distRoot, targetFromAlias)
  let specifier = relative(currentDirectory, absoluteTarget).replaceAll(
    "\\",
    "/"
  )

  specifier = posix.normalize(specifier)

  if (!specifier.startsWith(".")) {
    specifier = `./${specifier}`
  }

  return specifier
}

async function rewriteDeclarationImports(filePath) {
  const original = await readFile(filePath, "utf8")
  const rewritten = original.replace(
    specifierPattern,
    (_match, quote, target) => {
      const specifier = normalizeModuleSpecifier(filePath, target)
      return `${quote}${specifier}${quote}`
    }
  )

  if (rewritten !== original) {
    await writeFile(filePath, rewritten, "utf8")
  }
}

async function main() {
  const declarationFiles = await collectDeclarationFiles(distRoot)
  await Promise.all(declarationFiles.map(rewriteDeclarationImports))
}

main().catch((error) => {
  console.error("Failed to rewrite declaration imports:", error)
  process.exit(1)
})
