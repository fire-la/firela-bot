/**
 * Tests for Cloudflare API helpers
 *
 * Tests the cloudflare-api.ts utility functions using
 * mocked global fetch for HTTP calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  cfApiFetch,
  verifyCloudflareAuth,
  getAccountId,
  getLatestRelease,
  downloadReleaseAsset,
  enumerateResources,
  deleteResources,
} from "../lib/cloudflare-api.js"

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
})

function cfResponse(success: boolean, result: any, errors?: Array<{ message: string }>) {
  return {
    ok: success,
    status: success ? 200 : 400,
    json: () =>
      Promise.resolve({ success, result, errors }),
  }
}

describe("cfApiFetch", () => {
  it("returns result on successful API call", async () => {
    mockFetch.mockResolvedValueOnce(
      cfResponse(true, [{ id: "acc-123" }]),
    )

    const result = await cfApiFetch("test-token", "/accounts")

    expect(result).toEqual([{ id: "acc-123" }])
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer test-token" },
      }),
    )
  })

  it("throws with error message on API failure", async () => {
    mockFetch.mockResolvedValueOnce(
      cfResponse(false, null, [{ message: "Invalid token" }]),
    )

    await expect(cfApiFetch("bad-token", "/accounts")).rejects.toThrow(
      "Cloudflare API error: Invalid token",
    )
  })

  it("sends body and content-type when provided", async () => {
    mockFetch.mockResolvedValueOnce(cfResponse(true, {}))

    await cfApiFetch(
      "token",
      "/accounts/acc/workers/scripts/my-worker/content",
      "PUT",
      "bundle-content",
      "application/javascript",
    )

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "PUT",
        body: "bundle-content",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/javascript",
        },
      }),
    )
  })
})

describe("verifyCloudflareAuth", () => {
  it("returns true for valid token (200 response)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })

    const result = await verifyCloudflareAuth("valid-token")
    expect(result).toBe(true)
  })

  it("returns false for invalid token (non-200 response)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })

    const result = await verifyCloudflareAuth("invalid-token")
    expect(result).toBe(false)
  })
})

describe("getAccountId", () => {
  it("returns first account ID", async () => {
    mockFetch.mockResolvedValueOnce(
      cfResponse(true, [{ id: "acc-001" }, { id: "acc-002" }]),
    )

    const result = await getAccountId("token")
    expect(result).toBe("acc-001")
  })

  it("throws when no accounts found", async () => {
    mockFetch.mockResolvedValueOnce(cfResponse(true, []))

    await expect(getAccountId("token")).rejects.toThrow(
      "No Cloudflare accounts found",
    )
  })
})

describe("enumerateResources", () => {
  it("filters to firela/billclaw resources only", async () => {
    // Mock three parallel fetches: workers, databases, kv
    mockFetch
      .mockResolvedValueOnce(
        cfResponse(true, [
          { id: "firela-bot" },
          { id: "other-worker" },
          { id: "billclaw-bot" },
        ]),
      )
      .mockResolvedValueOnce(
        cfResponse(true, [
          { id: "db-1", name: "firela-db" },
          { id: "db-2", name: "unrelated-db" },
          { id: "db-3", name: "billclaw-store" },
        ]),
      )
      .mockResolvedValueOnce(
        cfResponse(true, [
          { id: "kv-1", title: "firela-config" },
          { id: "kv-2", title: "random-cache" },
        ]),
      )

    const result = await enumerateResources("token", "acc-123")

    expect(result.workers).toEqual([
      { id: "firela-bot" },
      { id: "billclaw-bot" },
    ])
    expect(result.databases).toEqual([
      { id: "db-1", name: "firela-db" },
      { id: "db-3", name: "billclaw-store" },
    ])
    expect(result.kvNamespaces).toEqual([{ id: "kv-1", title: "firela-config" }])
  })

  it("returns empty arrays when no matching resources", async () => {
    mockFetch
      .mockResolvedValueOnce(cfResponse(true, [{ id: "other-worker" }]))
      .mockResolvedValueOnce(cfResponse(true, [{ id: "db-1", name: "random-db" }]))
      .mockResolvedValueOnce(cfResponse(true, [{ id: "kv-1", title: "cache" }]))

    const result = await enumerateResources("token", "acc-123")

    expect(result.workers).toEqual([])
    expect(result.databases).toEqual([])
    expect(result.kvNamespaces).toEqual([])
  })
})

describe("deleteResources", () => {
  it("continues after individual failure and reports per-resource status", async () => {
    // First deletion succeeds
    mockFetch.mockResolvedValueOnce(cfResponse(true, null))
    // Second deletion fails
    mockFetch.mockResolvedValueOnce(
      cfResponse(false, null, [{ message: "Not found" }]),
    )
    // Third deletion succeeds
    mockFetch.mockResolvedValueOnce(cfResponse(true, null))

    const result = await deleteResources("token", "acc-123", {
      workers: ["worker-1", "worker-2"],
      databases: ["db-1"],
    })

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({
      resource: "worker-1",
      type: "Worker",
      success: true,
    })
    expect(result[1]).toEqual({
      resource: "worker-2",
      type: "Worker",
      success: false,
      error: "Cloudflare API error: Not found",
    })
    expect(result[2]).toEqual({
      resource: "db-1",
      type: "D1 Database",
      success: true,
    })
  })

  it("handles empty resource lists", async () => {
    const result = await deleteResources("token", "acc-123", {})

    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe("getLatestRelease", () => {
  it("returns release with tag name and assets", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tag_name: "v1.2.3",
          assets: [
            { id: 100, name: "firela-bot-worker.js", browser_download_url: "https://example.com/worker.js" },
            { id: 101, name: "source.tar.gz", browser_download_url: "https://example.com/source.tar.gz" },
          ],
        }),
    })

    const result = await getLatestRelease("gh-token")

    expect(result.tagName).toBe("v1.2.3")
    expect(result.assets).toEqual([
      { id: 100, name: "firela-bot-worker.js" },
      { id: 101, name: "source.tar.gz" },
    ])
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/fire-la/firela-bot/releases/latest",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer gh-token",
          Accept: "application/vnd.github+json",
        },
      }),
    )
  })

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 })

    await expect(getLatestRelease("gh-token")).rejects.toThrow(
      "Failed to fetch latest release: HTTP 403",
    )
  })

  it("works without token (anonymous access)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          tag_name: "v1.2.3",
          assets: [
            { id: 100, name: "firela-bot-worker.js", browser_download_url: "https://example.com/worker.js" },
          ],
        }),
    })

    const result = await getLatestRelease()

    expect(result.tagName).toBe("v1.2.3")
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/fire-la/firela-bot/releases/latest",
      expect.objectContaining({
        headers: {
          Accept: "application/vnd.github+json",
        },
      }),
    )
    // Verify no Authorization header was sent
    const callArgs = mockFetch.mock.calls[0][1] as { headers: Record<string, string> }
    expect(callArgs.headers).not.toHaveProperty("Authorization")
  })
})

describe("downloadReleaseAsset", () => {
  it("returns asset content as text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("const workerCode = 'hello';"),
    })

    const result = await downloadReleaseAsset("gh-token", 42)

    expect(result).toBe("const workerCode = 'hello';")
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/fire-la/firela-bot/releases/assets/42",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer gh-token",
          Accept: "application/octet-stream",
        },
        redirect: "follow",
      }),
    )
  })

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })

    await expect(downloadReleaseAsset("gh-token", 999)).rejects.toThrow(
      "Failed to download release asset: HTTP 404",
    )
  })

  it("works without token (anonymous access)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve("const workerCode = 'hello';"),
    })

    const result = await downloadReleaseAsset(undefined, 42)

    expect(result).toBe("const workerCode = 'hello';")
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/fire-la/firela-bot/releases/assets/42",
      expect.objectContaining({
        headers: {
          Accept: "application/octet-stream",
        },
        redirect: "follow",
      }),
    )
    // Verify no Authorization header was sent
    const callArgs = mockFetch.mock.calls[0][1] as { headers: Record<string, string> }
    expect(callArgs.headers).not.toHaveProperty("Authorization")
  })
})
