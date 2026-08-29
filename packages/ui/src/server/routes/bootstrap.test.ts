/**
 * First-run bootstrap surface tests (ADR-009 Decision C, issue #21; HTML + QR
 * upgrade issue #25).
 *
 * Covers the fresh gate (setup password / bootstrap_done close the surface),
 * the idempotent mint (refresh reuses the pending claim), stale-pointer
 * re-mint, and the minimal-static-HTML delivery contract: tappable
 * /pair#code= link (fragment, never a query param), grouped code block,
 * inline SVG QR, no scripts, no external subresources, no-store.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest"
import { Hono } from "hono"

import { bootstrapRoutes } from "./bootstrap.js"
import { makeD1 } from "../../test/fake-d1.js"
import {
  PAIR_BOOTSTRAP_CURRENT_KEY,
  PAIR_BOOTSTRAP_DONE_KEY,
  PAIR_CLAIM_TTL_SEC,
  SETUP_PASSWORD_KEY,
} from "../constants.js"
import type { Env } from "../index.js"

// --- in-memory KV fake (records put options for TTL assertions) ------------

type PutCall = { key: string; ttl?: number }

function makeKv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>()
  const puts: PutCall[] = []
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
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      store.set(key, value)
      puts.push({ key, ttl: options?.expirationTtl })
    },
    _puts: puts,
    _raw: (k: string) => store.get(k) ?? null,
  }
}

/**
 * Hono app mirroring the index.ts mount (root). An optional notFound lets the
 * fall-through cases assert delegation; without one, Hono's default
 * "404 Not Found" text handler is the oracle.
 */
function bootstrapApp(notFound?: (c: never) => Response | Promise<Response>) {
  const app = new Hono<{ Bindings: Env }>()
  app.route("/", bootstrapRoutes)
  if (notFound) app.notFound(notFound as never)
  return app
}

function env(kv: ReturnType<typeof makeKv>, db: ReturnType<typeof makeD1>) {
  return { CONFIG: kv, DB: db } as never
}

const GROUPED_RE = /^[0-9A-HJ-NP-Z]{4}-[0-9A-HJ-NP-Z]{4}$/ // Crockford: no I, L, O, U

/** Extract the raw code from the /pair#code= link in a page body. */
function rawCodeFromBody(body: string): string {
  const m = body.match(/\/pair#code=([0-9A-HJ-NP-Z]{8})/)
  if (!m) throw new Error("no pairing link in body")
  return m[1]!
}

describe("GET / — fresh deployment", () => {
  it("renders the pairing page: text/html, no-store, link + code + inline QR, zero scripts/external resources", async () => {
    const kv = makeKv()
    const db = makeD1()
    const res = await bootstrapApp().request("/", undefined, env(kv, db))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/^text\/html/)
    expect(res.headers.get("cache-control")).toBe("no-store")

    const body = await res.text()
    expect(body).toContain("http://localhost")
    expect(body).toContain("/auth/setup")
    expect(body).not.toContain("?code=") // fragment only, never a query param
    // Tappable link as a real <a href> element.
    expect(body).toContain(`<a href="http://localhost/pair#code=`)
    // Grouped code in its own selectable block.
    const grouped = body.match(/id="claim">([^<]+)</)![1]!
    expect(grouped).toMatch(GROUPED_RE)
    // Inline server-generated QR of the same pairing URL.
    expect(body).toContain("<svg")
    // Zero scripts, zero external subresources — everything inline.
    expect(body.toLowerCase()).not.toContain("<script")
    expect(body).not.toMatch(/<(link|img)\b/i)
    expect(body).not.toMatch(/\ssrc=/)

    // Claim stored pending in D1 with the bootstrap origin; pointer written
    // to KV with the claim TTL.
    const raw = rawCodeFromBody(body)
    expect(grouped.replace("-", "")).toBe(raw)
    expect(db._row(raw)).toMatchObject({ status: "pending", origin: "bootstrap" })
    expect(db._row(raw)!.created_at).toBeTypeOf("number")
    expect(kv._raw(PAIR_BOOTSTRAP_CURRENT_KEY)).toBe(raw)
    expect(
      kv._puts.find((p) => p.key === PAIR_BOOTSTRAP_CURRENT_KEY)?.ttl,
    ).toBe(PAIR_CLAIM_TTL_SEC)
  })

  it("refresh reuses the still-pending claim — no second mint", async () => {
    const kv = makeKv()
    const db = makeD1()
    const app = bootstrapApp()
    const first = await app.request("/", undefined, env(kv, db))
    const code1 = rawCodeFromBody(await first.text())
    const second = await app.request("/", undefined, env(kv, db))
    const code2 = rawCodeFromBody(await second.text())
    expect(code2).toBe(code1)
    expect(db._rows()).toHaveLength(1)
  })
})

describe("GET / — stale pointer re-mints", () => {
  const now = Math.floor(Date.now() / 1000)

  it("expired pending claim (created_at beyond TTL) -> new code", async () => {
    const kv = makeKv({ [PAIR_BOOTSTRAP_CURRENT_KEY]: "ABCD2345" })
    const db = makeD1({
      ABCD2345: { created_at: now - PAIR_CLAIM_TTL_SEC - 100 },
    })
    const res = await bootstrapApp().request("/", undefined, env(kv, db))
    const code = rawCodeFromBody(await res.text())
    expect(code).not.toBe("ABCD2345")
    expect(kv._raw(PAIR_BOOTSTRAP_CURRENT_KEY)).toBe(code)
  })

  it("used claim -> new code", async () => {
    const kv = makeKv({ [PAIR_BOOTSTRAP_CURRENT_KEY]: "ABCD2345" })
    const db = makeD1({ ABCD2345: { status: "used", created_at: now } })
    const res = await bootstrapApp().request("/", undefined, env(kv, db))
    expect(rawCodeFromBody(await res.text())).not.toBe("ABCD2345")
  })

  it("pruned claim (pointer outlived the claim row) -> new code", async () => {
    const kv = makeKv({ [PAIR_BOOTSTRAP_CURRENT_KEY]: "ABCD2345" })
    const res = await bootstrapApp().request("/", undefined, env(kv, makeD1()))
    expect(rawCodeFromBody(await res.text())).not.toBe("ABCD2345")
  })
})

describe("GET / — closed surface delegates to notFound (SPA fallback)", () => {
  it("bootstrap_done set -> default 404 (delegation, not rendering)", async () => {
    const kv = makeKv({
      [PAIR_BOOTSTRAP_DONE_KEY]: { appId: "x", completedAt: 1 },
    })
    const res = await bootstrapApp().request("/", undefined, env(kv, makeD1()))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe("404 Not Found")
    // No mint may happen on a closed surface.
    expect(kv._puts.length).toBe(0)
  })

  it("bootstrap_done set + SPA notFound -> ASSETS index.html re-entry", async () => {
    const kv = makeKv({
      [PAIR_BOOTSTRAP_DONE_KEY]: { appId: "x", completedAt: 1 },
    })
    const app = bootstrapApp(() =>
      new Response("<html>spa</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    )
    const res = await app.request("/", undefined, env(kv, makeD1()))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/^text\/html/)
    expect(await res.text()).toContain("spa")
  })

  it("setup password set (owner exists) -> falls through", async () => {
    const kv = makeKv({ [SETUP_PASSWORD_KEY]: "hunter2" })
    const res = await bootstrapApp().request("/", undefined, env(kv, makeD1()))
    expect(res.status).toBe(404)
    expect(kv._puts.length).toBe(0)
  })
})
