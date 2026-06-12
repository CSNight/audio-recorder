import { expect, test } from "@playwright/test"
import { RecorderInputSource, RecorderState } from "../../src/types"

test("phase 1 page renders and completes the external stream diagnostic", async ({
  page,
}) => {
  await page.goto("/?diagnostic=e2e")
  await expect(
    page.getByRole("heading", { name: "Recorder core chain is online" })
  ).toBeVisible()
  await expect(page.getByText("Phase 1")).toBeVisible()
  await expect(
    page.getByText("External stream diagnostic passed.")
  ).toBeVisible({
    timeout: 10_000,
  })
  await expect(page.locator("#diagnostic-output")).toContainText(
    `"${RecorderState.Stopped}"`
  )
  await expect(page.locator("#diagnostic-output")).toContainText(
    `"source": "${RecorderInputSource.ExternalStream}"`
  )
  await expect(page.locator("#diagnostic-output")).toContainText(
    '"channels": 2'
  )
})
