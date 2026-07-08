import { fileURLToPath, URL } from "node:url"
import { readdirSync } from "node:fs"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

const DIST_CODECS_BASE_DIR = fileURLToPath(
  new URL("../dist/codecs/base/", import.meta.url)
)

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function createDistWorkerAliases() {
  return readdirSync(DIST_CODECS_BASE_DIR)
    .filter((filename) => /^(pcm|wav)-worker-.*\.js$/.test(filename))
    .map((filename) => ({
      // playground 引用根仓库 dist 产物时，Vite 会把 worker 入口折算成
      // 相对 playground 根目录的路径；这里显式映射回真实文件，避免构建阶段丢失。
      find: new RegExp(
        `^\\.\\.\\/dist\\/codecs\\/base\\/${escapeRegex(filename)}$`
      ),
      replacement: fileURLToPath(
        new URL(`../dist/codecs/base/${filename}`, import.meta.url)
      ),
    }))
}

export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  resolve: {
    alias: [
      ...createDistWorkerAliases(),
      {
        find: "@media-studio/audio-recorder/plugins/level-meter",
        replacement: fileURLToPath(
          new URL("../dist/plugins/level-meter/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/plugins/streaming-export",
        replacement: fileURLToPath(
          new URL("../dist/plugins/streaming-export/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/plugins/streaming-player",
        replacement: fileURLToPath(
          new URL("../dist/plugins/streaming-player/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/plugins/frequency-histogram",
        replacement: fileURLToPath(
          new URL(
            "../dist/plugins/frequency-histogram/index.js",
            import.meta.url
          )
        ),
      },
      {
        find: "@media-studio/audio-recorder/plugins/dtmf",
        replacement: fileURLToPath(
          new URL("../dist/plugins/dtmf/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/plugins/nmn2pcm",
        replacement: fileURLToPath(
          new URL("../dist/plugins/nmn2pcm/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/plugins/sonic-export",
        replacement: fileURLToPath(
          new URL("../dist/plugins/sonic-export/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/plugins/asr-export",
        replacement: fileURLToPath(
          new URL("../dist/plugins/asr-export/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/plugins/dsp",
        replacement: fileURLToPath(
          new URL("../dist/plugins/dsp/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/storage/indexeddb",
        replacement: fileURLToPath(
          new URL("../dist/storage/indexeddb/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/storage/opfs",
        replacement: fileURLToPath(
          new URL("../dist/storage/opfs/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/codecs/base",
        replacement: fileURLToPath(
          new URL("../dist/codecs/base/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/codecs/mp3",
        replacement: fileURLToPath(
          new URL("../dist/codecs/mp3/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/codecs/g711",
        replacement: fileURLToPath(
          new URL("../dist/codecs/g711/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/codecs/opus",
        replacement: fileURLToPath(
          new URL("../dist/codecs/opus/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/codecs/flac",
        replacement: fileURLToPath(
          new URL("../dist/codecs/flac/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/codecs/aac",
        replacement: fileURLToPath(
          new URL("../dist/codecs/aac/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/codecs/amr",
        replacement: fileURLToPath(
          new URL("../dist/codecs/amr/index.js", import.meta.url)
        ),
      },
      {
        find: "@media-studio/audio-recorder/codecs/ac3",
        replacement: fileURLToPath(
          new URL("../dist/codecs/ac3/index.js", import.meta.url)
        ),
      },

      {
        find: "@media-studio/audio-recorder",
        replacement: fileURLToPath(
          new URL("../dist/index.js", import.meta.url)
        ),
      },
      {
        find: "vue",
        replacement: "vue/dist/vue.esm-bundler.js",
      },
    ],
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
})
