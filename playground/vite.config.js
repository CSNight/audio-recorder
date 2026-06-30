import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@audio-recorder-dist": fileURLToPath(
        new URL("../dist", import.meta.url)
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
