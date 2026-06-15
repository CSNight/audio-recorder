import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        index: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
        "encoders/pcm/index": fileURLToPath(
          new URL("./src/encoders/pcm/index.ts", import.meta.url)
        ),
        "encoders/wav/index": fileURLToPath(
          new URL("./src/encoders/wav/index.ts", import.meta.url)
        ),
        "plugins/level-meter/index": fileURLToPath(
          new URL("./src/plugins/level-meter/public.ts", import.meta.url)
        ),
        "storage/opfs/index": fileURLToPath(
          new URL("./src/storage/opfs/index.ts", import.meta.url)
        ),
        "storage/indexeddb/index": fileURLToPath(
          new URL("./src/storage/indexeddb/index.ts", import.meta.url)
        ),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
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
