/**
 * Unit tests for the mask-aware deep-merge PUT /api/config semantics
 * (fire-la/firela-app#359 Stage 2b backend fixes).
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from "vitest"

import { configRoutes } from "./config.js"

// Fake CONFIG KV namespace capturing the last written blob.
let lastPut: string | null = null
const store = new Map<string, string>()
const env = {
  CONFIG: {
    get: async (key: string, type?: string) => {
      const raw = store.get(key)
      if (raw === undefined) return null
      return type === "json" ? JSON.parse(raw) : raw
    },
    put: async (key: string, value: string) => {
      lastPut = value
      store.set(key, value)
    },
  },
} as never

function seed(json: Record<string, unknown>) {
  store.set("billclaw:config", JSON.stringify(json))
  lastPut = null
}

async function putConfig(partial: Record<string, unknown>) {
  return configRoutes.request(
    "/config",
    {
      method: "PUT",
      body: JSON.stringify(partial),
      headers: { "content-type": "application/json" },
    },
    env,
  )
}

describe("PUT /api/config (deep-merge)", () => {
  beforeEach(() => {
    store.clear()
    lastPut = null
  })

  it("partial PUT preserves untouched sibling keys", async () => {
    seed({
      vlt: { region: "us", accessToken: "live-secret" },
      upload: { mode: "manual" },
    })

    const res = await putConfig({ upload: { mode: "auto" } })
    expect(res.status).toBe(200)

    const merged = JSON.parse(lastPut!)
    expect(merged.upload.mode).toBe("auto")
    expect(merged.vlt.region).toBe("us")
    expect(merged.vlt.accessToken).toBe("live-secret")
  })

  it('a "***" leaf never clobbers the stored secret', async () => {
    seed({
      vlt: { region: "us", accessToken: "live-secret" },
    })

    // The SPA prefills forms from the masked GET; the save echoes masks back.
    await putConfig({
      vlt: { region: "us", accessToken: "***" },
    })

    const merged = JSON.parse(lastPut!)
    expect(merged.vlt.accessToken).toBe("live-secret")
  })

  it("explicit null deletes the key; omission preserves it", async () => {
    seed({ a: 1, b: 2 })

    await putConfig({ a: null })

    const merged = JSON.parse(lastPut!)
    expect(merged).toEqual({ b: 2 })
  })

  it("arrays replace atomically (no index-wise merge)", async () => {
    seed({ webhooks: [{ url: "a" }, { url: "b" }, { url: "c" }] })

    await putConfig({ webhooks: [{ url: "z" }] })

    const merged = JSON.parse(lastPut!)
    expect(merged.webhooks).toEqual([{ url: "z" }])
  })

  it("object sections merge by key; omitted keys persist", async () => {
    seed({ keep: true, section: { x: 1, y: 1 } })

    await putConfig({ section: { x: 2 } })

    const merged = JSON.parse(lastPut!)
    // Object sub-sections MERGE (that is the point of the PUT semantics) —
    // a sender that wants a key gone must send null, not omit it.
    expect(merged.section).toEqual({ x: 2, y: 1 })
    expect(merged.keep).toBe(true)
  })

  it("returns 400 when CONFIG KV is unavailable", async () => {
    const res = await configRoutes.request(
      "/config",
      {
        method: "PUT",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      },
      { CONFIG: undefined } as never,
    )
    expect(res.status).toBe(400)
  })
})
