import { describe, expect, it } from "vitest"
import { phase } from "../../src/index"

describe("phase 0 scaffold", () => {
  it("exports the current phase marker", () => {
    expect(phase).toBe("phase-0")
  })
})
