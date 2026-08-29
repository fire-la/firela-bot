/**
 * Unit tests for the mask-aware deep-merge PUT /api/config semantics
 * (fire-la/firela-app#359 Stage 2b backend fixes).
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach } from "vitest"
import { Hono } from "hono"

import { configRoutes } from "./config.js"
import { SETUP_PASSWORD_KEY } from "../constants.js"
import { makeD1 } from "../../test/fake-d1.js"

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

  it("prototype-chain keys (__proto__/constructor) are skipped, not stored", async () => {
    seed({ safe: 1 })

    await putConfig({
      safe: 2,
      __proto__: { polluted: true },
      constructor: { polluted: true },
    })

    const merged = JSON.parse(lastPut!)
    expect(merged).toEqual({ safe: 2 })
    expect(JSON.stringify(merged)).not.toContain("polluted")
  })

  it("app role: null-deletion is rejected (no section wipe); owner may delete", async () => {
    seed({ vlt: { region: "us", accessToken: "secret" } })

    // App role (jwtPayload.role === "app"). configRoutes mount at /api with
    // their own /config segment (mirrors index.ts).
    const appHono = new Hono()
    appHono.use("/api/*", async (c, next) => {
      c.set("jwtPayload", { sub: "x", role: "app" })
      await next()
    })
    appHono.route("/api", configRoutes)
    const denied = await appHono.request(
      "/api/config",
      {
        method: "PUT",
        body: JSON.stringify({ vlt: null }),
        headers: { "content-type": "application/json" },
      },
      env,
    )
    expect(denied.status).toBe(400)
    expect(lastPut).toBeNull() // rejected before any write
    expect(JSON.parse(store.get("billclaw:config")!)).toEqual({
      vlt: { region: "us", accessToken: "secret" },
    })

    // Owner role (no jwtPayload — direct route call) may still delete.
    const res = await putConfig({ vlt: null })
    expect(res.status).toBe(200)
    expect(JSON.parse(lastPut!)).toEqual({})
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

describe("PUT /settings/password", () => {
  // Local fakes: the shared module env above has no DB, and the throttle
  // needs the raw string KV (the json-parsing CONFIG there would mangle it).
  function makeEnv() {
    const store = new Map<string, string>([[SETUP_PASSWORD_KEY, "stored"]])
    return {
      CONFIG: {
        get: async (key: string) => store.get(key) ?? null,
        put: async (key: string, value: string) => store.set(key, value),
      },
      _raw: (key: string) => store.get(key) ?? null,
    }
  }

  function putPassword(
    env: ReturnType<typeof makeEnv>,
    db: ReturnType<typeof makeD1>,
    currentPassword: string,
    newPassword = "new-pass",
  ) {
    return configRoutes.request(
      "/settings/password",
      {
        method: "PUT",
        body: JSON.stringify({ currentPassword, newPassword }),
        headers: { "content-type": "application/json", "CF-Connecting-IP": "192.0.2.10" },
      },
      { CONFIG: env.CONFIG, DB: db } as never,
    )
  }

  it("changes the password on a correct current password", async () => {
    const env = makeEnv()
    const res = await putPassword(env, makeD1(), "stored")
    expect(res.status).toBe(200)
    expect(env._raw(SETUP_PASSWORD_KEY)).toBe("new-pass")
  })

  it("rejects a wrong current password with 401 and leaves it unchanged", async () => {
    const env = makeEnv()
    const res = await putPassword(env, makeD1(), "nope")
    expect(res.status).toBe(401)
    expect(env._raw(SETUP_PASSWORD_KEY)).toBe("stored")
  })

  it("locks after 5 wrong attempts with 429 + Retry-After (OCR: no throttle here would let a stolen owner JWT brute-force)", async () => {
    const env = makeEnv()
    const db = makeD1()
    for (let i = 0; i < 5; i++) {
      expect((await putPassword(env, db, "nope")).status).toBe(401)
    }
    const locked = await putPassword(env, db, "stored") // even the right one
    expect(locked.status).toBe(429)
    expect(locked.headers.get("Retry-After")).toBeTruthy()
    expect(env._raw(SETUP_PASSWORD_KEY)).toBe("stored")
  })
})
