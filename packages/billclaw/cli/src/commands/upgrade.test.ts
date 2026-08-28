/**
 * Tests for upgrade command
 *
 * Tests the billclaw upgrade command: auth -> build -> deploy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { upgradeCommand } from "./upgrade.js"
import { createMockCliContext } from "../__tests__/test-utils.js"

// Mock cloudflare utils
vi.mock("../utils/cloudflare.js", () => ({
  verifyCloudflareAuth: vi.fn(),
  getPackagePath: vi.fn((name: string) => `/mock/packages/${name}`),
  getMonorepoRoot: vi.fn(() => "/mock/monorepo-root"),
}))

// Mock wrangler deploy utilities
vi.mock("../utils/wrangler.js", () => ({
  deployUiWorker: vi.fn(),
  runCommand: vi.fn(),
}))

// Mock Spinner
vi.mock("../utils/progress.js", () => ({
  Spinner: {
    withLoading: vi.fn(async (_text: string, fn: () => Promise<unknown>) => {
      return fn()
    }),
  },
}))

// Mock format utilities
vi.mock("../utils/format.js", () => ({
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}))

import { verifyCloudflareAuth } from "../utils/cloudflare.js"
import { deployUiWorker, runCommand } from "../utils/wrangler.js"
import { success } from "../utils/format.js"

describe("upgrade command", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("command definition", () => {
    it("should have correct command name", () => {
      expect(upgradeCommand.name).toBe("upgrade")
    })

    it("should have a description", () => {
      expect(upgradeCommand.description).toBeDefined()
      expect(upgradeCommand.description.length).toBeGreaterThan(0)
    })

    it("should have a handler function", () => {
      expect(upgradeCommand.handler).toBeDefined()
      expect(typeof upgradeCommand.handler).toBe("function")
    })
  })

  describe("handler execution order", () => {
    it("should abort on auth failure without building or deploying", async () => {
      vi.mocked(verifyCloudflareAuth).mockRejectedValue(
        new Error("Not authenticated"),
      )

      const context = createMockCliContext()

      await expect(upgradeCommand.handler(context)).rejects.toThrow(
        "Not authenticated",
      )

      expect(verifyCloudflareAuth).toHaveBeenCalledOnce()
      expect(runCommand).not.toHaveBeenCalled()
      expect(deployUiWorker).not.toHaveBeenCalled()
    })

    it("should abort on build failure without deploying", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })
      vi.mocked(runCommand).mockRejectedValue(new Error("Build failed"))

      const context = createMockCliContext()

      await expect(upgradeCommand.handler(context)).rejects.toThrow(
        "Build failed",
      )

      expect(verifyCloudflareAuth).toHaveBeenCalledOnce()
      expect(runCommand).toHaveBeenCalledOnce()
      expect(deployUiWorker).not.toHaveBeenCalled()
    })

    it("should build then deploy on success", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })
      vi.mocked(runCommand).mockResolvedValue({
        code: 0,
        stdout: "",
        stderr: "",
      })
      vi.mocked(deployUiWorker).mockResolvedValue({
        workerUrl: "https://firela-bot.example.workers.dev",
        configPath: "/mock/packages/ui/wrangler.deploy.toml",
      })

      const context = createMockCliContext()
      await upgradeCommand.handler(context)

      expect(verifyCloudflareAuth).toHaveBeenCalledOnce()

      // Build at monorepo root
      expect(runCommand).toHaveBeenCalledWith("pnpm", ["build"], "/mock/monorepo-root")

      // Deploy in authenticated (non-temporary) mode
      expect(deployUiWorker).toHaveBeenCalledWith({ temporary: false })

      // Success summary printed
      expect(success).toHaveBeenCalled()
    })
  })
})
