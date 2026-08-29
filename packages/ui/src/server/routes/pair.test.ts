/**
 * Pairing route tests (ADR-009 PR-3).
 *
 * Covers the claim -> redeem -> revoke state machine, the app JWT contract,
 * claim-code shape, and the TTL-on-put guarantees (Fix A/B). Authz denial of
 * owner-only pair endpoints by an app token lives here too (APP_ROLE_PATH_DENIED).
 * Claims are exercised against the shared fake D1 (issue #24): the atomic-flip
 * specs (concurrent redeem, expiry) are the single-use regression tests.
 * The Turnstile gate on redeem (issue #23) is covered with a stubbed siteverify
 * fetch: the disabled path (no keys) never fetches, which is also the
 * regression proof that zero-config deploys keep the bare claim-code flow.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"
import { sign } from "hono/jwt"

import { pairRoutes } from "./pair.js"
import { authMiddleware } from "../middleware/auth.js"
import { ensureAuthSecret } from "../lib/auth-helpers.js"
import { normalizeClaimCode, generateClaimCode } from "../lib/pair-helpers.js"
import { makeD1 } from "../../test/fake-d1.js"
import {
  PAIR_APP_PREFIX,
  PAIR_APP_TTL_SEC,
  PAIR_BOOTSTRAP_DONE_KEY,
  PAIR_CLAIM_TTL_SEC,
  PAIR_TOKEN_TTL_SEC,
  SETUP_PASSWORD_KEY,
} from "../constants.js"
import type { Env } from "../index.js"

// --- in-memory KV fake (records put options for TTL assertions) ------------

type PutCall = { key: string; ttl?: number }

function makeKv(initial: Record<string, unknown> = {}, listPageSize = Infinity) {
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
    // Workers KV list contract: prefix-filtered keys, max `listPageSize` per
    // page, opaque cursor for the next page (index as string here).
    async list(opts?: { prefix?: string; cursor?: string }) {
      const prefix = opts?.prefix ?? ""
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort()
      const start = Number(opts?.cursor ?? 0)
      const page = names.slice(start, start + listPageSize)
      const done = start + page.length >= names.length
      return {
        keys: page.map((name) => ({ name })),
        list_complete: done,
        ...(done ? {} : { cursor: String(start + page.length) }),
      }
    },
    _puts: puts,
    _raw: (k: string) => store.get(k) ?? null,
  }
}

/** Hono app with authMiddleware + pairRoutes mounted (mirrors index.ts). */
function pairApp() {
  const app = new Hono<{ Bindings: Env }>()
  app.use("/api/*", authMiddleware)
  app.route("/api/pair", pairRoutes)
  // app-role-allowlisted reachability routes (so a redeemed token can be exercised)
  app.post("/api/sync/run", (c) => c.json({ success: true }))
  app.get("/api/sync/status", (c) => c.json({ success: true }))
  return app
}

function env(
  kv: ReturnType<typeof makeKv>,
  db: ReturnType<typeof makeD1>,
  extra: Record<string, string> = {},
) {
  return { CONFIG: kv, DB: db, ...extra } as never
}

/** Sign a token with the SAME secret authMiddleware will use (auto-seeded into kv). */
async function makeToken(
  kv: ReturnType<typeof makeKv>,
  role: string,
  sub: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const secret = await ensureAuthSecret({ CONFIG: kv } as never)
  return sign({ sub, role, iat: now, exp: now + 3600 }, secret, "HS256")
}

const CLAIM_RE = /^[0-9A-HJ-NP-Z]{8}$/ // Crockford: no I, L, O, U

async function issue(
  app: ReturnType<typeof pairApp>,
  kv: ReturnType<typeof makeKv>,
  db: ReturnType<typeof makeD1>,
  token: string,
): Promise<{ claimCode: string; expiresAt: number; workerUrl: string }> {
  const res = await app.request(
    "/api/pair/issue",
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    env(kv, db),
  )
  expect(res.status).toBe(200)
  return (await res.json()) as { claimCode: string; expiresAt: number; workerUrl: string }
}

describe("POST /api/pair/issue (owner)", () => {
  it("401 without a token", async () => {
    const kv = makeKv()
    const res = await pairApp().request("/api/pair/issue", { method: "POST" }, env(kv, makeD1()))
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("AUTH_MISSING")
  })

  it("401 APP_NOT_PAIRED with an app token and no pairing record", async () => {
    // /issue is now app-allowlisted (#26) — the middleware proceeds to the
    // fail-closed revocation read and rejects the recordless token there.
    const kv = makeKv()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")
    const res = await app.request(
      "/api/pair/issue",
      { method: "POST", headers: { Authorization: `Bearer ${appToken}` } },
      env(kv, makeD1()),
    )
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "APP_NOT_PAIRED",
    )
  })

  it("mints an 8-char Crockford code, stored pending in D1", async () => {
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")

    const body = await issue(app, kv, db, owner)
    expect(body.claimCode).toMatch(CLAIM_RE)
    expect(body.workerUrl).toMatch(/^https?:\/\//) // origin derived from c.req.url
    const claim = db._row(body.claimCode)
    expect(claim).toMatchObject({ status: "pending", origin: null })
    expect(claim!.created_at).toBeTypeOf("number")
    expect(body.expiresAt).toBe(claim!.created_at + PAIR_CLAIM_TTL_SEC)
  })

  it("mint prunes rows older than TTL + grace (lazy D1 cleanup)", async () => {
    const kv = makeKv()
    const db = makeD1({ OLDCODE: { created_at: 1 } })
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")

    await issue(app, kv, db, owner)
    expect(db._row("OLDCODE")).toBeUndefined()
  })
})

describe("POST /api/pair/redeem (public, claim-gated)", () => {
  it("redeems a valid claim: app JWT issued, claim flipped to used, record written", async () => {
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)

    const res = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv, db),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { pairingToken: string; appId: string; workerUrl: string }
    expect(body.pairingToken.split(".").length).toBe(3) // well-formed JWT
    expect(body.appId).toMatch(/^[0-9a-f-]{36}$/) // server-generated UUID

    const used = db._row(claimCode)
    expect(used).toMatchObject({ status: "used", app_id: body.appId })
    expect(used?.redeemed_at).toBeTypeOf("number")
    const rec = JSON.parse(kv._raw(PAIR_APP_PREFIX + body.appId)!)
    expect(rec).toMatchObject({ appId: body.appId, revoked: false })

    // Bootstrap surface closure (issue #21): any successful redeem permanently
    // closes GET / — flag value records the pairing, put carries no TTL.
    const done = JSON.parse(kv._raw(PAIR_BOOTSTRAP_DONE_KEY)!)
    expect(done.appId).toBe(body.appId)
    expect(typeof done.completedAt).toBe("number")
    expect(
      kv._puts.find((p) => p.key === PAIR_BOOTSTRAP_DONE_KEY)?.ttl,
    ).toBeUndefined()
  })

  it("concurrent redeems of one claim: exactly one wins the atomic flip (issue #24)", async () => {
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)

    // Two in-flight redeems — the no-CAS KV sequence let BOTH of these mint a
    // 1y JWT; the conditional D1 UPDATE must serialize them to 200 + 409.
    const [a, b] = await Promise.all(
      [0, 1].map(() =>
        app.request(
          "/api/pair/redeem",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ claimCode }),
          },
          env(kv, db),
        ),
      ),
    )
    expect([a.status, b.status].sort()).toEqual([200, 409])
    const winner = a.status === 200 ? a : b
    const loser = a.status === 200 ? b : a
    const winBody = (await winner.json()) as { appId: string }
    expect(((await loser.json()) as { errorCode: string }).errorCode).toBe(
      "CLAIM_ALREADY_USED",
    )

    // Exactly one app record, one bootstrap-done flag, and the flipped row
    // carries the winner's appId (the loser's UUID is discarded).
    expect(kv._puts.filter((p) => p.key.startsWith(PAIR_APP_PREFIX))).toHaveLength(1)
    expect(kv._puts.filter((p) => p.key === PAIR_BOOTSTRAP_DONE_KEY)).toHaveLength(1)
    expect(db._row(claimCode)?.app_id).toBe(winBody.appId)
  })

  it("redeemed token reaches the allowlisted sync routes", async () => {
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)
    const redeem = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv, db),
    )
    const { pairingToken } = (await redeem.json()) as { pairingToken: string }

    const run = await app.request(
      "/api/sync/run",
      { method: "POST", headers: { Authorization: `Bearer ${pairingToken}` } },
      env(kv, db),
    )
    expect(run.status).toBe(200)
    const status = await app.request(
      "/api/sync/status",
      { headers: { Authorization: `Bearer ${pairingToken}` } },
      env(kv, db),
    )
    expect(status.status).toBe(200)
  })

  it("second redeem of the same claim -> 409 CLAIM_ALREADY_USED", async () => {
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)

    const first = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv, db),
    )
    expect(first.status).toBe(200)

    const second = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv, db),
    )
    expect(second.status).toBe(409)
    expect(((await second.json()) as { errorCode: string }).errorCode).toBe(
      "CLAIM_ALREADY_USED",
    )
  })

  it("unknown / expired claim -> 404 CLAIM_NOT_FOUND", async () => {
    const kv = makeKv()
    const res = await pairApp().request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode: "NOPE0000" }),
      },
      env(kv, makeD1()),
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "CLAIM_NOT_FOUND",
    )
  })

  it("pending claim past the TTL cutoff -> 404 CLAIM_NOT_FOUND (not 409)", async () => {
    const kv = makeKv()
    const expired = Math.floor(Date.now() / 1000) - PAIR_CLAIM_TTL_SEC - 1
    const db = makeD1({ ABCD2345: { created_at: expired } })
    const res = await pairApp().request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode: "ABCD2345" }),
      },
      env(kv, db),
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "CLAIM_NOT_FOUND",
    )
  })

  it("normalizes an ambiguously-typed claim code (O->0, I/L->1, lowercase)", async () => {
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)
    // Mangle every ambiguous char the user could mis-type
    const mangled = claimCode
      .replace(/0/g, "O")
      .replace(/1/g, "I")
      .toLowerCase()

    const res = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode: mangled }),
      },
      env(kv, db),
    )
    expect(res.status).toBe(200)
  })
})

describe("GET /api/pair/config (public, issue #23)", () => {
  it("no keys configured -> disabled; reachable without auth (public path)", async () => {
    // No Authorization header: if /api/pair/config were not in PUBLIC_PATHS,
    // authMiddleware would 401 before the handler runs.
    const res = await pairApp().request("/api/pair/config", {}, env(makeKv(), makeD1()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      turnstileEnabled: false,
      sitekey: null,
    })
  })

  it("both keys configured -> enabled with the sitekey", async () => {
    const res = await pairApp().request(
      "/api/pair/config",
      {},
      env(makeKv(), makeD1(), {
        TURNSTILE_SITE_KEY: "site-key-1",
        TURNSTILE_SECRET_KEY: "sec-1",
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      turnstileEnabled: true,
      sitekey: "site-key-1",
    })
  })

  it("half-configured (either key alone) -> disabled with no sitekey: both are required", async () => {
    // Pins the both-required semantics AND the payload invariant (sitekey
    // non-null ⟺ enabled): a lone sitekey must not invite the app to render
    // a widget whose tokens /redeem would reject.
    const halves: Record<string, string>[] = [
      { TURNSTILE_SECRET_KEY: "sec-1" },
      { TURNSTILE_SITE_KEY: "site-key-1" },
    ]
    for (const extra of halves) {
      const res = await pairApp().request("/api/pair/config", {}, env(makeKv(), makeD1(), extra))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        success: true,
        turnstileEnabled: false,
        sitekey: null,
      })
    }
  })
})

describe("POST /api/pair/redeem + Turnstile (issue #23)", () => {
  const turnstileEnv = {
    TURNSTILE_SITE_KEY: "site-key-1",
    TURNSTILE_SECRET_KEY: "sec-1",
  }

  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("enforcement on, token missing -> 400 TURNSTILE_REQUIRED, claim untouched", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)

    const res = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv, db, turnstileEnv),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "TURNSTILE_REQUIRED",
    )
    // The gate runs before anything else: no siteverify round trip for a bare
    // missing token, and the claim row is never touched.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(db._row(claimCode)?.status).toBe("pending")
  })

  it("siteverify success -> full redeem, verified before the claim flip", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal("fetch", fetchSpy)
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)

    const res = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode, turnstileToken: "tok-1" }),
      },
      env(kv, db, turnstileEnv),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { pairingToken: string; appId: string }
    expect(body.pairingToken.split(".").length).toBe(3)
    expect(db._row(claimCode)).toMatchObject({ status: "used", app_id: body.appId })

    // Outbound siteverify call shape: one POST with secret + token.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, { method: string; body: string }]
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({ secret: "sec-1", response: "tok-1" })
  })

  it("siteverify rejects -> 403 TURNSTILE_INVALID; claim and KV untouched", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false }),
    })
    vi.stubGlobal("fetch", fetchSpy)
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)

    const res = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode, turnstileToken: "tok-1" }),
      },
      env(kv, db, turnstileEnv),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "TURNSTILE_INVALID",
    )
    // Rejected verify must not consume the claim, write a pairing record, or
    // close the bootstrap surface (that only happens on full success).
    expect(db._row(claimCode)?.status).toBe("pending")
    expect(kv._puts.filter((p) => p.key.startsWith(PAIR_APP_PREFIX))).toHaveLength(0)
    expect(kv._puts.filter((p) => p.key === PAIR_BOOTSTRAP_DONE_KEY)).toHaveLength(0)
  })

  it("siteverify unreachable -> 503 TURNSTILE_UNAVAILABLE (fail-closed)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"))
    vi.stubGlobal("fetch", fetchSpy)
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)

    const res = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode, turnstileToken: "tok-1" }),
      },
      env(kv, db, turnstileEnv),
    )
    expect(res.status).toBe(503)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "TURNSTILE_UNAVAILABLE",
    )
    expect(db._row(claimCode)?.status).toBe("pending")
  })
})

describe("POST /api/pair/revoke (owner)", () => {
  it("revokes a paired app; the app token is then rejected as AUTH_REVOKED", async () => {
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)
    const redeem = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv, db),
    )
    const { pairingToken, appId } = (await redeem.json()) as { pairingToken: string; appId: string }

    const revoke = await app.request(
      "/api/pair/revoke",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      },
      env(kv, db),
    )
    expect(revoke.status).toBe(200)

    const after = await app.request(
      "/api/sync/status",
      { headers: { Authorization: `Bearer ${pairingToken}` } },
      env(kv, db),
    )
    expect(after.status).toBe(401)
    expect(((await after.json()) as { errorCode: string }).errorCode).toBe("AUTH_REVOKED")
  })

  it("404 when revoking an unknown appId", async () => {
    const kv = makeKv()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const res = await app.request(
      "/api/pair/revoke",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appId: "ghost" }),
      },
      env(kv, makeD1()),
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("APP_NOT_PAIRED")
  })
})

describe("GET /api/pair/apps (owner)", () => {
  it("401 without a token", async () => {
    const kv = makeKv()
    const res = await pairApp().request("/api/pair/apps", {}, env(kv, makeD1()))
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("AUTH_MISSING")
  })

  it("403 APP_ROLE_PATH_DENIED with an app token (apps is owner-only)", async () => {
    const kv = makeKv()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")
    const res = await app.request(
      "/api/pair/apps",
      { headers: { Authorization: `Bearer ${appToken}` } },
      env(kv, makeD1()),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "APP_ROLE_PATH_DENIED",
    )
  })

  it("lists paired apps newest-first with revoked flags", async () => {
    const kv = makeKv({
      [PAIR_APP_PREFIX + "old"]: { appId: "old", pairedAt: 100, revoked: false },
      [PAIR_APP_PREFIX + "new"]: { appId: "new", pairedAt: 200, revoked: true },
    })
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const res = await app.request(
      "/api/pair/apps",
      { headers: { Authorization: `Bearer ${owner}` } },
      env(kv, makeD1()),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      apps: { appId: string; pairedAt: number; revoked: boolean }[]
    }
    expect(body.success).toBe(true)
    expect(body.apps.map((a) => a.appId)).toEqual(["new", "old"])
    expect(body.apps[0].revoked).toBe(true)
    expect(body.apps[1].revoked).toBe(false)
  })

  it("returns an empty list when nothing is paired", async () => {
    const kv = makeKv()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const res = await app.request(
      "/api/pair/apps",
      { headers: { Authorization: `Bearer ${owner}` } },
      env(kv, makeD1()),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, apps: [] })
  })

  it("skips malformed records (non-JSON value, missing pairedAt)", async () => {
    const kv = makeKv({
      [PAIR_APP_PREFIX + "good"]: { appId: "good", pairedAt: 300, revoked: false },
      [PAIR_APP_PREFIX + "junk"]: "not-json",
      [PAIR_APP_PREFIX + "partial"]: { appId: "partial" },
    })
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const res = await app.request(
      "/api/pair/apps",
      { headers: { Authorization: `Bearer ${owner}` } },
      env(kv, makeD1()),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { apps: { appId: string }[] }
    expect(body.apps.map((a) => a.appId)).toEqual(["good"])
  })

  it("walks multiple KV list pages via cursor", async () => {
    const kv = makeKv(
      {
        [PAIR_APP_PREFIX + "a"]: { appId: "a", pairedAt: 1, revoked: false },
        [PAIR_APP_PREFIX + "b"]: { appId: "b", pairedAt: 2, revoked: false },
        [PAIR_APP_PREFIX + "c"]: { appId: "c", pairedAt: 3, revoked: false },
      },
      1, // one key per list page -> cursor loop must iterate 3 times
    )
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const res = await app.request(
      "/api/pair/apps",
      { headers: { Authorization: `Bearer ${owner}` } },
      env(kv, makeD1()),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { apps: { appId: string }[] }
    expect(body.apps.map((a) => a.appId)).toEqual(["c", "b", "a"])
  })

  it("end-to-end: issue -> redeem -> revoke -> listed as revoked", async () => {
    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)
    const redeem = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv, db),
    )
    const { appId } = (await redeem.json()) as { appId: string }
    await app.request(
      "/api/pair/revoke",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      },
      env(kv, db),
    )

    const res = await app.request(
      "/api/pair/apps",
      { headers: { Authorization: `Bearer ${owner}` } },
      env(kv, db),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      apps: { appId: string; pairedAt: number; revoked: boolean }[]
    }
    expect(body.apps).toHaveLength(1)
    expect(body.apps[0]).toMatchObject({ appId, revoked: true })
    expect(body.apps[0].pairedAt).toBeTypeOf("number")
  })
})

describe("TTL guarantees (Fix A/B)", () => {
  it("app-record puts (redeem + revoke) carry PAIR_APP_TTL_SEC == token TTL", async () => {
    expect(PAIR_APP_TTL_SEC).toBe(PAIR_TOKEN_TTL_SEC)

    const kv = makeKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, db, owner)
    const redeem = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv, db),
    )
    const { appId } = (await redeem.json()) as { appId: string }
    await app.request(
      "/api/pair/revoke",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      },
      env(kv, db),
    )

    const appPuts = kv._puts.filter((p) => p.key.startsWith(PAIR_APP_PREFIX))
    expect(appPuts.length).toBe(2) // redeem write + revoke re-put
    expect(appPuts.every((p) => p.ttl === PAIR_APP_TTL_SEC)).toBe(true)
  })
})

describe("claim-code shape", () => {
  it("generateClaimCode produces 8 Crockford chars (no I/L/O/U)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateClaimCode()).toMatch(CLAIM_RE)
    }
  })

  it("normalizeClaimCode applies Crockford disambiguation", () => {
    expect(normalizeClaimCode("OIL")).toBe("011")
    expect(normalizeClaimCode("oil")).toBe("011")
    expect(normalizeClaimCode("abcd")).toBe("ABCD")
    expect(normalizeClaimCode("0123")).toBe("0123") // digits pass through
  })
})

// --- Track C (issue #26): app-side mint via owner-password proof --------------

/** KV state of one live paired device (`app-1`) with the owner password set. */
function pairedKv(withPassword = true) {
  const initial: Record<string, unknown> = {
    [PAIR_APP_PREFIX + "app-1"]: { appId: "app-1", pairedAt: 1, revoked: false },
  }
  if (withPassword) initial[SETUP_PASSWORD_KEY] = "hunter2"
  return makeKv(initial)
}

/** POST a JSON body with the caller's Bearer token. */
async function post(
  app: ReturnType<typeof pairApp>,
  path: string,
  kv: ReturnType<typeof makeKv>,
  db: ReturnType<typeof makeD1>,
  token: string,
  body?: unknown,
): Promise<Response> {
  return app.request(
    path,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env(kv, db),
  )
}

describe("POST /api/pair/issue (app role, owner-password proof — #26)", () => {
  it("mints with the correct password, stored with origin 'app'", async () => {
    const kv = pairedKv()
    const db = makeD1()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    const res = await post(app, "/api/pair/issue", kv, db, appToken, {
      password: "hunter2",
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      claimCode: string
      expiresAt: number
      workerUrl: string
    }
    expect(body.claimCode).toMatch(CLAIM_RE)
    expect(db._row(body.claimCode)).toMatchObject({
      status: "pending",
      origin: "app",
    })
    expect(body.expiresAt).toBe(
      db._row(body.claimCode)!.created_at + PAIR_CLAIM_TTL_SEC,
    )
  })

  it("401 OWNER_PASSWORD_INVALID on a wrong password, no claim row minted", async () => {
    const kv = pairedKv()
    const db = makeD1()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    const res = await post(app, "/api/pair/issue", kv, db, appToken, {
      password: "wrong",
    })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "OWNER_PASSWORD_INVALID",
    )
    expect(db._rows()).toHaveLength(0) // proof runs BEFORE the mint
    expect(db._throttle("app-1")!.failures).toBe(1)
  })

  it("409 OWNER_PASSWORD_REQUIRED when no owner password exists (ownerless)", async () => {
    const kv = pairedKv(false)
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    const res = await post(app, "/api/pair/issue", kv, makeD1(), appToken, {
      password: "whatever",
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "OWNER_PASSWORD_REQUIRED",
    )
  })

  it("400 OWNER_PASSWORD_MISSING with no body or no password field", async () => {
    const kv = pairedKv()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    const noBody = await post(app, "/api/pair/issue", kv, makeD1(), appToken)
    expect(noBody.status).toBe(400)
    expect(((await noBody.json()) as { errorCode: string }).errorCode).toBe(
      "OWNER_PASSWORD_MISSING",
    )

    const noField = await post(app, "/api/pair/issue", kv, makeD1(), appToken, {})
    expect(noField.status).toBe(400)
  })

  it("owner empty-body path is unchanged (regression)", async () => {
    const kv = pairedKv()
    const db = makeD1()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const body = await issue(app, kv, db, owner)
    expect(db._row(body.claimCode)!.origin).toBeNull()
  })

  it("refuses even the correct password while throttled (429 PROOF_THROTTLED)", async () => {
    const kv = pairedKv()
    const db = makeD1(
      {},
      { "app-1": { failures: 9, locked_until: Math.floor(Date.now() / 1000) + 60 } },
    )
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    const res = await post(app, "/api/pair/issue", kv, db, appToken, {
      password: "hunter2",
    })
    expect(res.status).toBe(429)
    const body = (await res.json()) as { errorCode: string; retryAfter: number }
    expect(body.errorCode).toBe("PROOF_THROTTLED")
    expect(body.retryAfter).toBeGreaterThan(0)
    expect(db._rows()).toHaveLength(0)
    // Locked attempts must not grow the counter (decay is by time alone).
    expect(db._throttle("app-1")!.failures).toBe(9)
  })

  it("arms the lock on the 5th wrong password and clears on success", async () => {
    const kv = pairedKv()
    const db = makeD1()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    for (let i = 0; i < 4; i++) {
      const res = await post(app, "/api/pair/issue", kv, db, appToken, {
        password: "wrong",
      })
      expect(res.status).toBe(401)
      expect(db._throttle("app-1")!.locked_until).toBe(0) // free failures
    }
    const fifth = await post(app, "/api/pair/issue", kv, db, appToken, {
      password: "wrong",
    })
    expect(fifth.status).toBe(401)
    expect(db._throttle("app-1")!.failures).toBe(5)
    expect(db._throttle("app-1")!.locked_until).toBeGreaterThan(
      Math.floor(Date.now() / 1000) - 1,
    )

    // A fresh counter (lock expired scenario): a successful proof deletes it.
    const db2 = makeD1({}, { "app-1": { failures: 2, locked_until: 0 } })
    const ok = await post(app, "/api/pair/issue", kv, db2, appToken, {
      password: "hunter2",
    })
    expect(ok.status).toBe(200)
    expect(db2._throttle("app-1")).toBeUndefined()
  })
})

describe("POST /api/pair/establish-owner (app only, ownerless start — #26)", () => {
  it("creates the password and returns the first claim in one response, no token", async () => {
    const kv = pairedKv(false)
    const db = makeD1()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    const res = await post(app, "/api/pair/establish-owner", kv, db, appToken, {
      password: "new-password",
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown> & {
      claimCode: string
      expiresAt: number
    }
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBe("new-password")
    expect(body.claimCode).toMatch(CLAIM_RE)
    expect(db._row(body.claimCode)).toMatchObject({
      status: "pending",
      origin: "app",
    })
    expect(body.expiresAt).toBe(
      db._row(body.claimCode)!.created_at + PAIR_CLAIM_TTL_SEC,
    )
    expect(body.token).toBeUndefined() // never an owner credential to the app
    expect(body.pairingToken).toBeUndefined()
  })

  it("409 OWNER_ALREADY_ESTABLISHED once a password exists", async () => {
    const kv = pairedKv()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    const res = await post(app, "/api/pair/establish-owner", kv, makeD1(), appToken, {
      password: "another",
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "OWNER_ALREADY_ESTABLISHED",
    )
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBe("hunter2") // not overwritten
  })

  it("403 for a non-app caller (owner)", async () => {
    const kv = pairedKv(false)
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")

    const res = await post(app, "/api/pair/establish-owner", kv, makeD1(), owner, {
      password: "x",
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "AUTH_INVALID_ROLE",
    )
  })

  it("401 APP_NOT_PAIRED with an app token and no pairing record", async () => {
    const kv = makeKv()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    const res = await post(app, "/api/pair/establish-owner", kv, makeD1(), appToken, {
      password: "x",
    })
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "APP_NOT_PAIRED",
    )
  })

  it("429 while the shared proof lock is held", async () => {
    const kv = pairedKv(false)
    const db = makeD1(
      {},
      { "app-1": { failures: 7, locked_until: Math.floor(Date.now() / 1000) + 60 } },
    )
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")

    const res = await post(app, "/api/pair/establish-owner", kv, db, appToken, {
      password: "x",
    })
    expect(res.status).toBe(429)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "PROOF_THROTTLED",
    )
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBeNull() // nothing written
  })
})
