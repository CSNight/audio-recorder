import { defineConfig } from "@playwright/test"

const isHeadless =
  process.env.PW_HEADLESS === "1" ||
  (process.env.PW_HEADLESS !== "0" && process.env.CI === "true")

export default defineConfig({
  testDir: "./tests/functional",
  testMatch: /playground-layout\.spec\.ts/,
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
    baseURL: "http://127.0.0.1:4174",
  },
  webServer: {
    command:
      "npm run build && npm --prefix playground run dev -- --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
