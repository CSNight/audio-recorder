import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import { workerChunksPlugin } from "./scripts/vite-worker-relink-plugin"

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: "oxc",
    lib: {
      entry: {
        index: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
        "storage/opfs/index": fileURLToPath(
          new URL("./src/storage/opfs/index.ts", import.meta.url)
        ),
        "storage/indexeddb/index": fileURLToPath(
          new URL("./src/storage/indexeddb/index.ts", import.meta.url)
        ),
        "plugins/level-meter/index": fileURLToPath(
          new URL("./src/plugins/level-meter/index.ts", import.meta.url)
        ),
        "plugins/streaming-export/index": fileURLToPath(
          new URL("./src/plugins/streaming-export/index.ts", import.meta.url)
        ),
        "plugins/asr-export/index": fileURLToPath(
          new URL("./src/plugins/asr-export/index.ts", import.meta.url)
        ),
        "plugins/streaming-player/index": fileURLToPath(
          new URL("./src/plugins/streaming-player/index.ts", import.meta.url)
        ),
        "codecs/base/index": fileURLToPath(
          new URL("./src/codecs/base/index.ts", import.meta.url)
        ),
        "codecs/mp3/index": fileURLToPath(
          new URL("./src/codecs/mp3/index.ts", import.meta.url)
        ),
        "codecs/g711/index": fileURLToPath(
          new URL("./src/codecs/g711/index.ts", import.meta.url)
        ),
        "codecs/opus/index": fileURLToPath(
          new URL("./src/codecs/opus/index.ts", import.meta.url)
        ),
        "codecs/flac/index": fileURLToPath(
          new URL("./src/codecs/flac/index.ts", import.meta.url)
        ),
        "codecs/aac/index": fileURLToPath(
          new URL("./src/codecs/aac/index.ts", import.meta.url)
        ),
        "codecs/amr/index": fileURLToPath(
          new URL("./src/codecs/amr/index.ts", import.meta.url)
        ),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: ["@csnight/audio-recorder"],
      output: {
        minify: true,
        comments: false,
        chunkFileNames: (chunkInfo) => {
          const name = chunkInfo.name ?? ""
          const wasmMatch = name.match(/^lib([a-z0-9]+?)(?:nb|wb)?\.wasm/)
          if (wasmMatch) return `codecs/${wasmMatch[1]}/[name]-[hash].js`
          return "chunks/[name]-[hash].js"
        },
        sourcemap: false,
      },
    },
    sourcemap: false,
    target: "es2022",
  },
  worker: {
    format: "es",
  },
  plugins: [workerChunksPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
