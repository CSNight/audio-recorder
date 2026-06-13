import { expect, test } from "@playwright/test"

test("playground consumes the built library artifact and completes an external stream lifecycle", async ({
  page,
}) => {
  await page.goto("/playground/")

  await expect(
    page.getByRole("heading", { name: "audio-recorder 简版示例页" })
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
