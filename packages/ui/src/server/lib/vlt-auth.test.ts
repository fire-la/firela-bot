/**
 * Unit tests for the Worker-side VLT JWT exchange + KV cache.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

import {
  getVltJwt,
  VLT_JWT_KV_KEY,
  type VltAuthConfig,
} from "./vlt-auth.js"

function makeKv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>()
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, typeof v === "string" ? v : JSON.stringify(v))
  }
  return {
    async get(key: string, opts?: unknown) {
      const raw = store.get(key)
      if (raw == null) return null
      if (opts === "json") {
        try {
          return JSON.parse(raw)
        } catch {
          return null
        }
      }
      return raw
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
    _raw: (key: string) => store.get(key),
  }
}

const vlt: VltAuthConfig = {
  apiUrl: "https://vlt.test/api/v1",
  accessToken: "long-lived",
  region: "us",
}

describe("getVltJwt", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns a fresh cached JWT without fetching", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const kv = makeKv({
      [VLT_JWT_KV_KEY]: {
        authToken: "cached-jwt",
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
    })

    const token = await getVltJwt(
      { CONFIG: kv as never },
      vlt,
    )

    expect(token).toBe("cached-jwt")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("exchanges and caches when missing", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ authToken: "fresh-jwt" }),
      text: async () => "",
    }))
    vi.stubGlobal("fetch", fetchSpy)
    const kv = makeKv({})

    const token = await getVltJwt(
      { CONFIG: kv as never },
      vlt,
    )

    expect(token).toBe("fresh-jwt")
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://vlt.test/api/v1/us/auth/sessions/anonymous",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ accessToken: "long-lived" }),
      }),
    )
    const stored = JSON.parse(kv._raw(VLT_JWT_KV_KEY)!) as {
      authToken: string
      expiresAt: string
    }
    expect(stored.authToken).toBe("fresh-jwt")
    expect(stored.expiresAt).toBeTruthy()
  })

  it("throws when the exchange response is not ok", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
      text: async () => "bad token",
    }))
    vi.stubGlobal("fetch", fetchSpy)
    const kv = makeKv({})

    await expect(
      getVltJwt({ CONFIG: kv as never }, vlt),
    ).rejects.toThrow(/401/)
  })
})
