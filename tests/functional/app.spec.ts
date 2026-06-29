import { expect, test } from "@playwright/test"

test("playground consumes the built library artifact and completes an external stream lifecycle", async ({
  page,
}) => {
  await page.goto("/playground/")

  await expect(
    page.getByRole("heading", { name: "@csnight/audio-recorder 简版示例页" })
  ).toBeVisible()
  await expect(page.getByText("Built Artifact Only")).toBeVisible()

  await page.getByTestId("source-mode").selectOption("external-tone")
  await page.getByTestId("channel-count").selectOption("2")
  await page.getByRole("button", { name: "打开" }).click()
  await page.getByRole("button", { name: "开始" }).click()

  await expect(page.locator("#state-value")).toHaveText("recording")
  await expect(page.locator("#frame-count-value")).not.toHaveText("0", {
    timeout: 10_000,
  })
  await expect(page.locator("#runtime-json")).toContainText(
    '"source": "external-stream"'
  )

  await page.getByRole("button", { name: "停止" }).click()
  await expect(page.locator("#state-value")).toHaveText("stopped")
  await expect(page.locator("#summary-json")).toContainText(
    '"state": "stopped"'
  )

  await page.getByRole("button", { name: "关闭" }).click()
  await expect(page.locator("#state-value")).toHaveText("closed")
  await expect(page.locator("#log-list")).toContainText(
    "Vue playground 已就绪。该页面直接依赖 /dist/index.js，而不是 src 源码。"
  )
})

test("playground can spill PCM into IndexedDB and clean session storage on close", async ({
  page,
}) => {
  await page.goto("/playground/")

  await page.getByTestId("source-mode").selectOption("external-tone")
  await page.getByTestId("channel-count").selectOption("2")
  await page.getByTestId("storage-mode").selectOption("auto")
  await page.getByTestId("persistence-backend").selectOption("indexeddb")
  await page.getByTestId("memory-threshold").fill("65536")

  await expect(page.getByTestId("storage-hint")).toContainText("IndexedDB")

  await page.getByRole("button", { name: "打开" }).click()
  await page.getByRole("button", { name: "开始" }).click()
  await expect(page.locator("#state-value")).toHaveText("recording")
  await page.waitForTimeout(2500)
  await expect
    .poll(async () => {
      const text = await page.locator("#frame-count-value").textContent()
      return Number.parseInt(text ?? "0", 10)
    })
    .toBeGreaterThan(100)

  await page.getByRole("button", { name: "停止" }).click()

  await expect(page.locator("#state-value")).toHaveText("stopped")
  await expect(page.getByTestId("pending-action-value")).toHaveText("-")
  await expect(page.getByTestId("active-persistence-backend")).toHaveText(
    "indexeddb"
  )
  await expect(page.getByTestId("exported-bytes-value")).not.toHaveText("-")
  await expect(page.getByTestId("storage-json")).toContainText(
    '"backend": "indexeddb"'
  )
  await expect(page.getByTestId("storage-json")).not.toContainText(
    '"persistedEntries": 0'
  )
  await expect(page.getByTestId("storage-json")).not.toContainText('"bytes": 0')
  await expect(page.getByTestId("storage-json")).not.toContainText(
    '"bytes": 541'
  )

  await page.getByRole("button", { name: "关闭" }).click()

  await expect(page.locator("#state-value")).toHaveText("closed")
  await expect(page.getByTestId("storage-json")).toContainText(
    '"persistedEntries": 0'
  )
})

test("playground can start directly in persistent IndexedDB mode", async ({
  page,
}) => {
  await page.goto("/playground/")

  await page.getByTestId("source-mode").selectOption("external-tone")
  await page.getByTestId("storage-mode").selectOption("persistent")
  await page.getByTestId("persistence-backend").selectOption("indexeddb")

  await expect(page.getByTestId("storage-hint")).toContainText(
    "从录音开始即启用"
  )

  await page.getByRole("button", { name: "打开" }).click()
  await page.getByRole("button", { name: "开始" }).click()
  await expect(page.locator("#state-value")).toHaveText("recording")
  await page.waitForTimeout(1500)

  await page.getByRole("button", { name: "停止" }).click()

  await expect(page.getByTestId("pending-action-value")).toHaveText("-")
  await expect(page.getByTestId("active-persistence-backend")).toHaveText(
    "indexeddb"
  )
  await expect(page.getByTestId("storage-json")).toContainText(
    '"backend": "indexeddb"'
  )

  await page.getByRole("button", { name: "关闭" }).click()
  await expect(page.locator("#state-value")).toHaveText("closed")
})

test("playground can start directly in persistent OPFS mode", async ({
  page,
}) => {
  await page.goto("/playground/")

  await page.getByTestId("source-mode").selectOption("external-tone")
  await page.getByTestId("storage-mode").selectOption("persistent")
  await page.getByTestId("persistence-backend").selectOption("opfs")

  await expect(page.getByTestId("storage-hint")).toContainText("OPFS")

  await page.getByRole("button", { name: "打开" }).click()
  await page.getByRole("button", { name: "开始" }).click()
  await expect(page.locator("#state-value")).toHaveText("recording")
  await page.waitForTimeout(1500)

  await page.getByRole("button", { name: "停止" }).click()

  await expect(page.getByTestId("pending-action-value")).toHaveText("-")
  await expect(page.getByTestId("active-persistence-backend")).toHaveText(
    "opfs"
  )
  await expect(page.getByTestId("storage-json")).toContainText(
    '"backend": "opfs"'
  )
  await expect(page.getByTestId("storage-json")).not.toContainText(
    '"persistedEntries": 0'
  )
  await expect(page.getByTestId("storage-json")).not.toContainText('"bytes": 0')

  await page.getByRole("button", { name: "关闭" }).click()
  await expect(page.locator("#state-value")).toHaveText("closed")
  await expect(page.getByTestId("storage-json")).toContainText(
    '"persistedEntries": 0'
  )
})
