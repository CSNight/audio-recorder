import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: "oxc",
    lib: {
      entry: {
        index: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
        "plugins/level-meter/index": fileURLToPath(
          new URL("./src/plugins/level-meter/public.ts", import.meta.url)
        ),
        "storage/opfs/index": fileURLToPath(
          new URL("./src/storage/opfs/index.ts", import.meta.url)
        ),
        "storage/indexeddb/index": fileURLToPath(
          new URL("./src/storage/indexeddb/index.ts", import.meta.url)
        ),
        "plugins/streaming-export/index": fileURLToPath(
          new URL("./src/plugins/streaming-export/index.ts", import.meta.url)
        ),
        "codecs/mp3/index": fileURLToPath(
          new URL("./src/codecs/mp3/index.ts", import.meta.url)
        ),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      output: { minify: true },
    },
    sourcemap: false,
    target: "es2022",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
