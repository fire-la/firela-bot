/**
 * Tests for Cloudflare utilities
 *
 * Tests auth verification, wrangler.toml parsing, and package path resolution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// Mock global fetch for auth tests
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

import {
  verifyCloudflareAuth,
  parseWranglerToml,
  getPackagePath,
} from "./cloudflare.js"

describe("cloudflare utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.CLOUDFLARE_API_TOKEN
  })

  describe("verifyCloudflareAuth", () => {
    it("should resolve when CLOUDFLARE_API_TOKEN is set and API returns success", async () => {
      process.env.CLOUDFLARE_API_TOKEN = "test-token-123"
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "active" }),
      })

      const result = await verifyCloudflareAuth()

      expect(result).toEqual({ status: "active" })
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.cloudflare.com/client/v4/user/tokens/verify",
        {
          headers: {
            Authorization: "Bearer test-token-123",
          },
        },
      )
    })

    it("should throw error with wrangler login guidance when CLOUDFLARE_API_TOKEN is not set", async () => {
      delete process.env.CLOUDFLARE_API_TOKEN

      await expect(verifyCloudflareAuth()).rejects.toThrow("wrangler login")
    })

    it("should throw error with details when API returns failure", async () => {
      process.env.CLOUDFLARE_API_TOKEN = "bad-token"
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          errors: [{ message: "Invalid token" }],
        }),
      })

      await expect(verifyCloudflareAuth()).rejects.toThrow("Invalid token")
    })
  })

  describe("parseWranglerToml", () => {
    it("should extract resources from UI wrangler.toml content", () => {
      const uiToml = `
name = "firela-bot"
main = "src/server/index.ts"
compatibility_date = "2025-09-15"

[[d1_databases]]
binding = "DB"
database_name = "firela-bot-data"
database_id = "ae67cab3-392b-4f46-b783-9a8e32b6250f"

[[kv_namespaces]]
binding = "CONFIG"
id = "59865e1e3cb34909ade239a6423f7fec"
`
      const result = parseWranglerToml(uiToml)

      expect(result.workerName).toBe("firela-bot")
      expect(result.d1DatabaseId).toBe("ae67cab3-392b-4f46-b783-9a8e32b6250f")
      expect(result.d1DatabaseName).toBe("firela-bot-data")
      expect(result.kvNamespaceId).toBe("59865e1e3cb34909ade239a6423f7fec")
      expect(result.kvBindingName).toBe("CONFIG")
    })

    it("should extract resources from firela-bot wrangler.toml content", () => {
      const botToml = `
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
      const result = parseWranglerToml(botToml)

      expect(result.workerName).toBe("firela-bot")
      expect(result.d1DatabaseId).toBe("575adfe2-38ec-4849-86b6-313eaeb6ed9d")
      expect(result.d1DatabaseName).toBe("firela-memory")
      expect(result.kvNamespaceId).toBe("078b1d7583954002a50f5d7df2821555")
      expect(result.kvBindingName).toBe("CONVERSATION_KV")
    })

    it("should throw when worker name not found", () => {
      const toml = `
main = "src/index.ts"
[[d1_databases]]
database_id = "some-id"
[[kv_namespaces]]
id = "some-kv-id"
`
      expect(() => parseWranglerToml(toml)).toThrow("Worker name")
    })

    it("should throw when database_id not found", () => {
      const toml = `
name = "test-worker"
[[kv_namespaces]]
id = "some-kv-id"
`
      expect(() => parseWranglerToml(toml)).toThrow("database_id")
    })

    it("should throw when KV namespace id not found", () => {
      const toml = `
name = "test-worker"
[[d1_databases]]
database_id = "some-id"
`
      expect(() => parseWranglerToml(toml)).toThrow("KV namespace")
    })

    it("should use defaults for optional fields when missing", () => {
      const toml = `
name = "test-worker"
[[d1_databases]]
database_id = "some-db-id"
[[kv_namespaces]]
id = "some-kv-id"
`
      const result = parseWranglerToml(toml)

      expect(result.d1DatabaseName).toBe("")
      expect(result.kvBindingName).toBe("")
    })
  })

  describe("getPackagePath", () => {
    it("should resolve correct absolute path for ui package", () => {
      const result = getPackagePath("ui")

      expect(result).toMatch(/packages\/ui$/)
      expect(result).not.toContain("..")
    })

    it("should resolve correct absolute path for firela-bot package", () => {
      const result = getPackagePath("firela-bot")

      expect(result).toMatch(/packages\/firela-bot$/)
      expect(result).not.toContain("..")
    })
  })
})
