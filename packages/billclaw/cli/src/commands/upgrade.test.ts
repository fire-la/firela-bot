/**
 * Tests for upgrade command
 *
 * Tests the billclaw upgrade command: auth -> build -> deploy ui -> deploy bot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { upgradeCommand } from "./upgrade.js"
import { createMockCliContext } from "../__tests__/test-utils.js"

// Mock cloudflare utils
vi.mock("../utils/cloudflare.js", () => ({
  verifyCloudflareAuth: vi.fn(),
  getPackagePath: vi.fn((name: string) => `/mock/packages/${name}`),
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

// Mock child_process.spawn
const mockSpawn = vi.fn()
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

import { verifyCloudflareAuth } from "../utils/cloudflare.js"
import { success } from "../utils/format.js"

/**
 * Create a mock spawn process that resolves or rejects
 */
function createMockProcess(exitCode: number, stderr = "") {
  const listeners: Record<string, Array<(data: unknown) => void>> = {}
  return {
    stdout: {
      on: (event: string, cb: (data: unknown) => void) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(cb)
      },
    },
    stderr: {
      on: (event: string, cb: (data: unknown) => void) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(cb)
        if (stderr && event === "data") {
          cb(Buffer.from(stderr))
        }
      },
    },
    on: (event: string, cb: (code: unknown) => void) => {
      if (event === "exit") {
        // Simulate async exit
        setTimeout(() => cb(exitCode), 0)
      } else if (event === "error") {
        // No error simulation
      }
    },
  }
}

describe("upgrade command", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSpawn.mockReset()
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
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it("should abort on build failure without deploying", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })

      // First spawn call (build) fails
      mockSpawn.mockImplementationOnce(() => createMockProcess(1, "Build failed"))

      const context = createMockCliContext()

      await expect(upgradeCommand.handler(context)).rejects.toThrow()

      expect(verifyCloudflareAuth).toHaveBeenCalledOnce()
      // Only build was attempted, no deploy
      expect(mockSpawn).toHaveBeenCalledTimes(1)
    })

    it("should abort on UI deploy failure without deploying bot", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })

      // Build succeeds
      mockSpawn.mockImplementationOnce(() => createMockProcess(0))
      // UI deploy fails
      mockSpawn.mockImplementationOnce(() =>
        createMockProcess(1, "UI deploy failed"),
      )

      const context = createMockCliContext()

      await expect(upgradeCommand.handler(context)).rejects.toThrow()

      expect(mockSpawn).toHaveBeenCalledTimes(2)
    })

    it("should call all steps in order on success", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })

      // All spawn calls succeed
      mockSpawn.mockImplementation(() => createMockProcess(0))

      const context = createMockCliContext()
      await upgradeCommand.handler(context)

      // Auth check
      expect(verifyCloudflareAuth).toHaveBeenCalledOnce()

      // 3 spawn calls: build, deploy ui, deploy bot
      expect(mockSpawn).toHaveBeenCalledTimes(3)

      // Verify build call
      const buildCall = mockSpawn.mock.calls[0]
      expect(buildCall[0]).toBe("pnpm")
      expect(buildCall[1]).toEqual(["build"])
      expect(buildCall[2].cwd).toMatch(/main$/)

      // Verify UI deploy call
      const uiDeployCall = mockSpawn.mock.calls[1]
      expect(uiDeployCall[0]).toBe("pnpm")
      expect(uiDeployCall[1]).toEqual(["run", "deploy"])
      expect(uiDeployCall[2].cwd).toContain("ui")

      // Verify bot deploy call
      const botDeployCall = mockSpawn.mock.calls[2]
      expect(botDeployCall[0]).toBe("pnpm")
      expect(botDeployCall[1]).toEqual(["run", "deploy"])
      expect(botDeployCall[2].cwd).toContain("firela-bot")

      // Success summary printed
      expect(success).toHaveBeenCalled()
    })
  })
})
