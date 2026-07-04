import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
  plugins: [vue()],
  publicDir: false,
  resolve: {
    alias: [
      {
        find: "@csnight/audio-recorder/plugins/level-meter",
        replacement: fileURLToPath(
          new URL("../dist/plugins/level-meter/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/plugins/streaming-export",
        replacement: fileURLToPath(
          new URL("../dist/plugins/streaming-export/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/plugins/streaming-player",
        replacement: fileURLToPath(
          new URL("../dist/plugins/streaming-player/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/plugins/sonic-export",
        replacement: fileURLToPath(
          new URL("../dist/plugins/sonic-export/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/plugins/asr-export",
        replacement: fileURLToPath(
          new URL("../dist/plugins/asr-export/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/storage/indexeddb",
        replacement: fileURLToPath(
          new URL("../dist/storage/indexeddb/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/storage/opfs",
        replacement: fileURLToPath(
          new URL("../dist/storage/opfs/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/codecs/base",
        replacement: fileURLToPath(
          new URL("../dist/codecs/base/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/codecs/mp3",
        replacement: fileURLToPath(
          new URL("../dist/codecs/mp3/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/codecs/g711",
        replacement: fileURLToPath(
          new URL("../dist/codecs/g711/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/codecs/opus",
        replacement: fileURLToPath(
          new URL("../dist/codecs/opus/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/codecs/flac",
        replacement: fileURLToPath(
          new URL("../dist/codecs/flac/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/codecs/aac",
        replacement: fileURLToPath(
          new URL("../dist/codecs/aac/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/codecs/amr",
        replacement: fileURLToPath(
          new URL("../dist/codecs/amr/index.js", import.meta.url)
        ),
      },
      {
        find: "@csnight/audio-recorder/codecs/ac3",
        replacement: fileURLToPath(
          new URL("../dist/codecs/ac3/index.js", import.meta.url)
        ),
      },

      {
        find: "@csnight/audio-recorder",
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
