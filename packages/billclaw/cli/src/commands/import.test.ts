/**
 * Tests for Import command
 *
 * @module @firela/billclaw-cli
 */

import { describe, it, expect, vi } from "vitest"
import { importCommand } from "./import.js"

// Mock dependencies
vi.mock("node:fs")
vi.mock("../utils/progress.js")
vi.mock("../utils/format.js")
vi.mock("@firela/billclaw-core")
vi.mock("@firela/billclaw-core/parsers")

describe("importCommand", () => {
  describe("command definition", () => {
    it("should have correct name", () => {
      expect(importCommand.name).toBe("import")
    })

    it("should have description", () => {
      expect(importCommand.description).toBeDefined()
      expect(importCommand.description.length).toBeGreaterThan(0)
    })

    it("should have file argument", () => {
      expect(importCommand.arguments).toBe("<file>")
    })

    it("should have expected options", () => {
      const optionFlags = importCommand.options?.map((o) => o.flags) || []
      expect(optionFlags).toContain("-p, --parser <name>")
      expect(optionFlags).toContain("-a, --account <id>")
      expect(optionFlags).toContain("-d, --dry-run")
    })

    it("should have handler function", () => {
      expect(importCommand.handler).toBeDefined()
      expect(typeof importCommand.handler).toBe("function")
    })
  })
})

describe("runImport", () => {
  it("should validate command structure", () => {
    // Check command structure is correct
    expect(importCommand).toMatchObject({
      name: "import",
      description: expect.any(String),
      arguments: "<file>",
      options: expect.arrayContaining([
        expect.objectContaining({ flags: expect.stringContaining("parser") }),
        expect.objectContaining({ flags: expect.stringContaining("account") }),
        expect.objectContaining({ flags: expect.stringContaining("dry-run") }),
      ]),
      handler: expect.any(Function),
    })
  })

  it("should have correct option descriptions", () => {
    const parserOption = importCommand.options?.find((o) => o.flags.includes("parser"))
    expect(parserOption?.description).toContain("auto-detect")

    const accountOption = importCommand.options?.find((o) => o.flags.includes("account"))
    expect(accountOption?.description).toContain("account")

    const dryRunOption = importCommand.options?.find((o) => o.flags.includes("dry-run"))
    expect(dryRunOption?.description).toContain("upload")
  })
})
