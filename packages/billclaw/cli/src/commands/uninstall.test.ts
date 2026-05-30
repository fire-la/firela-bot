/**
 * Tests for uninstall command
 *
 * Tests the billclaw uninstall command: auth -> discover resources -> confirm -> delete.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { uninstallCommand } from "./uninstall.js"
import { createMockCliContext } from "../__tests__/test-utils.js"

// Mock cloudflare utils
vi.mock("../utils/cloudflare.js", () => ({
  verifyCloudflareAuth: vi.fn(),
  parseWranglerToml: vi.fn(),
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

// Mock inquirer
vi.mock("inquirer", () => ({
  default: {
    prompt: vi.fn(),
  },
}))

// Mock node:fs/promises for wrangler.toml reading
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}))

import { verifyCloudflareAuth, parseWranglerToml } from "../utils/cloudflare.js"
import inquirer from "inquirer"
import * as fs from "node:fs/promises"

const UI_TOML = `
name = "firela-bot"
main = "src/server/index.ts"

[[d1_databases]]
binding = "DB"
database_name = "firela-bot-data"
database_id = "152e5c7f-90da-4256-b142-c6e36e3690f9"

[[kv_namespaces]]
binding = "CONFIG"
id = "95ccdd7ead584b34ac9efb6c16131d37"
`

const BOT_TOML = `
name = "firela-bot"
main = "dist/worker.js"

[[d1_databases]]
binding = "DB"
database_name = "firela-memory"
database_id = "575adfe2-38ec-4849-86b6-313eaeb6ed9d"

[[kv_namespaces]]
binding = "CONVERSATION_KV"
id = "078b1d7583954002a50f5d7df2821555"
`

const MOCK_UI_RESOURCES = {
  workerName: "firela-bot",
  d1DatabaseId: "152e5c7f-90da-4256-b142-c6e36e3690f9",
  d1DatabaseName: "firela-bot-data",
  kvNamespaceId: "95ccdd7ead584b34ac9efb6c16131d37",
  kvBindingName: "CONFIG",
}

const MOCK_BOT_RESOURCES = {
  workerName: "firela-bot",
  d1DatabaseId: "575adfe2-38ec-4849-86b6-313eaeb6ed9d",
  d1DatabaseName: "firela-memory",
  kvNamespaceId: "078b1d7583954002a50f5d7df2821555",
  kvBindingName: "CONVERSATION_KV",
}

describe("uninstall command", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  let originalToken: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock global fetch
    mockFetch = vi.fn()
    vi.stubGlobal("fetch", mockFetch)
    // Set env var needed by cfApiFetch
    originalToken = process.env.CLOUDFLARE_API_TOKEN
    process.env.CLOUDFLARE_API_TOKEN = "test-token"
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    // Restore env var
    if (originalToken === undefined) {
      delete process.env.CLOUDFLARE_API_TOKEN
    } else {
      process.env.CLOUDFLARE_API_TOKEN = originalToken
    }
  })

  describe("command definition", () => {
    it("should have correct command name", () => {
      expect(uninstallCommand.name).toBe("uninstall")
    })

    it("should have a description", () => {
      expect(uninstallCommand.description).toBeDefined()
      expect(uninstallCommand.description.length).toBeGreaterThan(0)
    })

    it("should have a handler function", () => {
      expect(uninstallCommand.handler).toBeDefined()
      expect(typeof uninstallCommand.handler).toBe("function")
    })
  })

  describe("auth failure", () => {
    it("should abort on auth failure without any API calls", async () => {
      vi.mocked(verifyCloudflareAuth).mockRejectedValue(
        new Error("Not authenticated"),
      )

      const context = createMockCliContext()

      await expect(uninstallCommand.handler(context)).rejects.toThrow(
        "Not authenticated",
      )

      expect(verifyCloudflareAuth).toHaveBeenCalledOnce()
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe("no accounts", () => {
    it("should throw when no Cloudflare accounts found", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })

      // Mock getAccountId - accounts returns empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [],
        }),
      })

      const context = createMockCliContext()

      await expect(uninstallCommand.handler(context)).rejects.toThrow(
        "No Cloudflare accounts found",
      )
    })
  })

  describe("declining confirmation", () => {
    it("should exit with no deletions when user declines", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })

      // Mock getAccountId
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [{ id: "test-account-id" }],
        }),
      })

      vi.mocked(parseWranglerToml)
        .mockReturnValueOnce(MOCK_UI_RESOURCES)
        .mockReturnValueOnce(MOCK_BOT_RESOURCES)

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(UI_TOML)
        .mockResolvedValueOnce(BOT_TOML)

      // User declines confirmation
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: false })

      const context = createMockCliContext()
      await uninstallCommand.handler(context)

      // No DELETE calls should have been made
      const deleteCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => (call[1] as RequestInit)?.method === "DELETE",
      )
      expect(deleteCalls).toHaveLength(0)
    })
  })

  describe("accepting confirmation", () => {
    it("should call all 6 DELETE endpoints when user confirms", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })

      // Mock getAccountId
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [{ id: "test-account-id" }],
        }),
      })

      vi.mocked(parseWranglerToml)
        .mockReturnValueOnce(MOCK_UI_RESOURCES)
        .mockReturnValueOnce(MOCK_BOT_RESOURCES)

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(UI_TOML)
        .mockResolvedValueOnce(BOT_TOML)

      // User confirms
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: true })

      // Mock 6 DELETE responses (2 Workers + 2 D1 + 2 KV)
      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, result: {} }),
        })
      }

      const context = createMockCliContext()
      await uninstallCommand.handler(context)

      // Verify all DELETE calls were made
      const deleteCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => (call[1] as RequestInit)?.method === "DELETE",
      )
      expect(deleteCalls).toHaveLength(6)

      // Verify endpoints: 2 Workers, 2 D1, 2 KV
      const urls = deleteCalls.map((call: unknown[]) => call[0] as string)

      expect(urls.some((url) => url.includes("/workers/scripts/firela-bot"))).toBe(true)
      expect(urls.some((url) => url.includes("/workers/scripts/firela-bot"))).toBe(true)
      expect(urls.some((url) => url.includes("/d1/database/152e5c7f-90da-4256-b142-c6e36e3690f9"))).toBe(true)
      expect(urls.some((url) => url.includes("/d1/database/575adfe2"))).toBe(true)
      expect(urls.some((url) => url.includes("/storage/kv/namespaces/95ccdd7ead584b34ac9efb6c16131d37"))).toBe(true)
      expect(urls.some((url) => url.includes("/storage/kv/namespaces/078b1d75"))).toBe(true)
    })
  })

  describe("individual deletion failure", () => {
    it("should report failure but continue with other deletions", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })

      // Mock getAccountId
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [{ id: "test-account-id" }],
        }),
      })

      vi.mocked(parseWranglerToml)
        .mockReturnValueOnce(MOCK_UI_RESOURCES)
        .mockReturnValueOnce(MOCK_BOT_RESOURCES)

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(UI_TOML)
        .mockResolvedValueOnce(BOT_TOML)

      // User confirms
      vi.mocked(inquirer.prompt).mockResolvedValueOnce({ proceed: true })

      // Mock DELETE responses: 1st Worker fails, rest succeed
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          errors: [{ message: "Worker not found" }],
        }),
      })
      // Remaining 5 succeed
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, result: {} }),
        })
      }

      const context = createMockCliContext()
      await uninstallCommand.handler(context)

      // All 6 DELETE calls should have been attempted
      const deleteCalls = mockFetch.mock.calls.filter(
        (call: unknown[]) => (call[1] as RequestInit)?.method === "DELETE",
      )
      expect(deleteCalls).toHaveLength(6)
    })
  })

  describe("getAccountId", () => {
    it("should throw when no accounts returned", async () => {
      // This is tested above via the full flow, but let's test
      // the API error response path too
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: [],
        }),
      })

      const context = createMockCliContext()

      await expect(uninstallCommand.handler(context)).rejects.toThrow(
        "No Cloudflare accounts found",
      )
    })
  })

  describe("Cloudflare API error", () => {
    it("should throw on API error response", async () => {
      vi.mocked(verifyCloudflareAuth).mockResolvedValue({ status: "active" })

      // Mock getAccountId with API error
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          errors: [{ message: "Invalid API token" }],
        }),
      })

      const context = createMockCliContext()

      await expect(uninstallCommand.handler(context)).rejects.toThrow(
        "Cloudflare API error",
      )
    })
  })
})
