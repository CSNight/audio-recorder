import { expect, test } from "@playwright/test"

test("phase 0 page renders", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "audio-recorder" })).toBeVisible()
  await expect(page.getByText("Phase 0 scaffold is ready.")).toBeVisible()
})
