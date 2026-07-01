import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@csnight/audio-recorder": fileURLToPath(
        new URL("../dist/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/plugins/level-meter": fileURLToPath(
        new URL("../dist/plugins/level-meter/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/plugins/streaming-export": fileURLToPath(
        new URL("../dist/plugins/streaming-export/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/plugins/asr-export": fileURLToPath(
        new URL("../dist/plugins/asr-export/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/storage/indexeddb": fileURLToPath(
        new URL("../dist/storage/indexeddb/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/storage/opfs": fileURLToPath(
        new URL("../dist/storage/opfs/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/codecs/base": fileURLToPath(
        new URL("../dist/codecs/base/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/codecs/mp3": fileURLToPath(
        new URL("../dist/codecs/mp3/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/codecs/g711": fileURLToPath(
        new URL("../dist/codecs/g711/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/codecs/opus": fileURLToPath(
        new URL("../dist/codecs/opus/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/codecs/flac": fileURLToPath(
        new URL("../dist/codecs/flac/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/codecs/aac": fileURLToPath(
        new URL("../dist/codecs/aac/index.js", import.meta.url)
      ),
      "@csnight/audio-recorder/codecs/amr": fileURLToPath(
        new URL("../dist/codecs/amr/index.js", import.meta.url)
      ),
      vue: "vue/dist/vue.esm-bundler.js",
    },
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
