import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { type Plugin } from "vite"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 将 `dist/assets/xxx-worker-[hash].js` 移动到 `dist/codecs/xxx/xxx-worker-[hash].js`，
 * 并修正引用该 worker 文件的 codecs entry chunk 里的路径。
 */
export function workerChunksPlugin(): Plugin {
  return {
    name: "move-worker-chunks",
    apply: "build",
    enforce: "post",
    closeBundle() {
      const outDir = path.resolve(__dirname, "..", "dist")
      const assetsDir = path.join(outDir, "assets")
      if (!fs.existsSync(assetsDir)) return

      // 找出所有 assets 目录下的 worker 文件，如 "mp3-worker-C2EJWrl_.js"
      const workerFiles = fs
        .readdirSync(assetsDir)
        .filter((f) => /-worker-[A-Za-z0-9_-]+\.js$/.test(f))

      // 收集 dist 下所有可能引用 worker 的 entry chunk（codecs/*/index.js）
      const codecsDir = path.join(outDir, "codecs")
      const candidateIndexFiles: string[] = []
      if (fs.existsSync(codecsDir)) {
        for (const dirName of fs.readdirSync(codecsDir)) {
          const indexPath = path.join(codecsDir, dirName, "index.js")
          if (fs.existsSync(indexPath)) candidateIndexFiles.push(indexPath)
        }
      }

      for (const workerFile of workerFiles) {
        const escapedName = workerFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const refPattern = new RegExp(`/assets/${escapedName}`, "g")

        // 找出真正引用了该 worker 文件的 codecs/xxx/index.js（可能不止一个）
        const referencingIndexFiles = candidateIndexFiles.filter(
          (indexPath) => {
            const content = fs.readFileSync(indexPath, "utf-8")
            return refPattern.test(content)
          }
        )
        if (referencingIndexFiles.length === 0) continue

        // worker 文件只移动一次：放到第一个引用它的 codec 目录下
        const targetDir = path.dirname(referencingIndexFiles[0]!)
        const srcPath = path.join(assetsDir, workerFile)
        const dstPath = path.join(targetDir, workerFile)

        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, dstPath)
          fs.unlinkSync(srcPath)
        }

        // 修正所有引用该 worker 的 index.js 里的路径。
        // 原始内容形如: new Worker(`/assets/xxx-worker-[hash].js`, {...})
        // 注意：不能简单替换成裸的相对路径字符串 "./xxx-worker-[hash].js"，
        // 因为 `new Worker(url)` 在浏览器里是相对于"当前文档 URL"解析的，
        // 而不是相对于该模块文件本身。当本库被其他应用从非根路径引入时
        // （例如 playground 页面位于 /playground/），裸相对路径会被错误地解析到
        // /playground/xxx-worker-[hash].js 而 404。
        // 因此需要把整个反引号字符串替换为 `new URL("./xxx-worker-[hash].js", import.meta.url)`，
        // 这样无论页面 URL 是什么，都会相对于该 chunk 自身的 import.meta.url 正确解析。
        for (const indexPath of referencingIndexFiles) {
          const content = fs.readFileSync(indexPath, "utf-8")
          const indexDir = path.dirname(indexPath)
          const relPrefix =
            indexDir === targetDir
              ? "./"
              : `${path.relative(indexDir, targetDir).split(path.sep).join("/")}/`
          // Match: new Worker(`/assets/xxx-worker-hash.js`,{type:`module`,...})
          // Replace with: new Worker(new URL("./xxx-worker-hash.js", import.meta.url),{type:"module",...})
          // Must also fix `module` template literal → "module" string literal,
          // otherwise Vite's dev-server vite:worker-import-meta-url plugin errors:
          // "Expected worker options type property to be a literal value."
          const backtickRefPattern = new RegExp(
            `\`/assets/${escapedName}\`,\\{type:\`module\``,
            "g"
          )
          const replaced = content.replace(
            backtickRefPattern,
            `new URL("${relPrefix}${workerFile}", import.meta.url),{type:"module"`
          )
          fs.writeFileSync(indexPath, replaced, "utf-8")
        }
      }

      // 清理 worker 子构建在 assets 目录产生的冗余副本（worker js + wasm js）
      // 此时所有有效文件已移动完毕，assets 目录里剩余的都是可丢弃的副本
      // 用 setTimeout 延迟到当前 tick 之后执行，确保 worker 子构建也已完成写文件
      setTimeout(() => {
        if (!fs.existsSync(assetsDir)) return
        for (const f of fs.readdirSync(assetsDir)) {
          fs.unlinkSync(path.join(assetsDir, f))
        }
        fs.rmdirSync(assetsDir)
      }, 0)
    },
  }
}
