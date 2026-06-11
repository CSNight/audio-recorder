import { defineConfig } from "playwright/test"

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
    headless: true,
    baseURL: "http://127.0.0.1:4173",
  },
  webServer: {
    command: "D:\\Software\\NodeJs\\npm.cmd run dev -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
