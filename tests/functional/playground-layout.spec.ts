import { expect, test } from "@playwright/test"

test.describe("playground layout inspection", () => {
  test("captures the overall desktop layout", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1600 })
    await page.goto("/")

    await expect(page.locator("main.page-shell")).toBeVisible()
    await expect(page.locator(".topbar")).toBeVisible()
    await expect(page.locator(".player-section-shell .sp-wrap")).toBeVisible()

    const logPanel = page.locator(".side-column .log-panel-body")
    await expect(logPanel).toBeVisible()

    const logBox = await logPanel.boundingBox()
    expect(logBox?.height ?? 0).toBeLessThanOrEqual(560)

    await page.screenshot({
      path: testInfo.outputPath("playground-desktop.png"),
      fullPage: true,
    })
  })

  test("captures the streaming player layout", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await page.goto("/")

    const playerShell = page.locator(".player-section-shell")
    await playerShell.scrollIntoViewIfNeeded()
    await expect(playerShell).toBeVisible()

    await playerShell.screenshot({
      path: testInfo.outputPath("playground-player.png"),
    })
  })

  test("player log panel stays bounded when many log rows are present", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await page.goto("/")

    const playerLogList = page.locator(".sp-log-list")
    await expect(playerLogList).toBeVisible()

    await playerLogList.evaluate((element) => {
      const list = element as HTMLUListElement
      list.innerHTML = ""
      for (let index = 0; index < 200; index += 1) {
        const item = document.createElement("li")
        item.className = "sp-log-item"
        item.textContent = `[mock ${index}] player log row used for overflow verification`
        list.appendChild(item)
      }
    })

    const metrics = await playerLogList.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }))

    expect(metrics.clientHeight).toBeLessThanOrEqual(460)
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
  })
})
