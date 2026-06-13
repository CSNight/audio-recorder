import { defineConfig } from "playwright/test"

const isHeadless =
  process.env.PW_HEADLESS === "1" ||
  (process.env.PW_HEADLESS !== "0" && process.env.CI === "true")

export default defineConfig({
  testDir: "./tests/functional",
  timeout: 30_000,
  projects: [
    {
      name: "chrome",
      use: {
        channel: "chrome",
      },
    },
  ],
  use: {
    headless: isHeadless,
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command:
      "npm run build && node .\\node_modules\\vite\\bin\\vite.js --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
