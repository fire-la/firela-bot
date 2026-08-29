/**
 * Pairing route tests (ADR-009 PR-3).
 *
 * Covers the claim -> redeem -> revoke state machine, the app JWT contract,
 * claim-code shape, and the TTL-on-put guarantees (Fix A/B). Authz denial of
 * owner-only pair endpoints by an app token lives here too (APP_ROLE_PATH_DENIED).
 *
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import { sign } from "hono/jwt"

import { pairRoutes } from "./pair.js"
import { authMiddleware } from "../middleware/auth.js"
import { ensureAuthSecret } from "../lib/auth-helpers.js"
import { normalizeClaimCode, generateClaimCode } from "../lib/pair-helpers.js"
import {
  PAIR_APP_PREFIX,
  PAIR_APP_TTL_SEC,
  PAIR_BOOTSTRAP_DONE_KEY,
  PAIR_CLAIM_PREFIX,
  PAIR_CLAIM_TTL_SEC,
  PAIR_TOKEN_TTL_SEC,
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

function env(kv: ReturnType<typeof makeKv>) {
  return { CONFIG: kv } as never
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
  token: string,
): Promise<{ claimCode: string; expiresAt: number; workerUrl: string }> {
  const res = await app.request(
    "/api/pair/issue",
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    env(kv),
  )
  expect(res.status).toBe(200)
  return (await res.json()) as { claimCode: string; expiresAt: number; workerUrl: string }
}

describe("POST /api/pair/issue (owner)", () => {
  it("401 without a token", async () => {
    const kv = makeKv()
    const res = await pairApp().request("/api/pair/issue", { method: "POST" }, env(kv))
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("AUTH_MISSING")
  })

  it("403 APP_ROLE_PATH_DENIED with an app token (issue is owner-only)", async () => {
    const kv = makeKv()
    const app = pairApp()
    const appToken = await makeToken(kv, "app", "app-1")
    const res = await app.request(
      "/api/pair/issue",
      { method: "POST", headers: { Authorization: `Bearer ${appToken}` } },
      env(kv),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "APP_ROLE_PATH_DENIED",
    )
  })

  it("mints an 8-char Crockford code, stored pending with the claim TTL", async () => {
    const kv = makeKv()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")

    const body = await issue(app, kv, owner)
    expect(body.claimCode).toMatch(CLAIM_RE)
    expect(body.workerUrl).toMatch(/^https?:\/\//) // origin derived from c.req.url
    const claim = JSON.parse(kv._raw(PAIR_CLAIM_PREFIX + body.claimCode)!)
    expect(claim.status).toBe("pending")
    expect(claim.createdAt).toBeTypeOf("number")
    expect(body.expiresAt).toBe(claim.createdAt + PAIR_CLAIM_TTL_SEC)

    const claimPuts = kv._puts.filter((p) => p.key.startsWith(PAIR_CLAIM_PREFIX))
    expect(claimPuts.every((p) => p.ttl === PAIR_CLAIM_TTL_SEC)).toBe(true)
  })
})

describe("POST /api/pair/redeem (public, claim-gated)", () => {
  it("redeems a valid claim: app JWT issued, claim flipped to used, record written", async () => {
    const kv = makeKv()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, owner)

    const res = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { pairingToken: string; appId: string; workerUrl: string }
    expect(body.pairingToken.split(".").length).toBe(3) // well-formed JWT
    expect(body.appId).toMatch(/^[0-9a-f-]{36}$/) // server-generated UUID

    const used = JSON.parse(kv._raw(PAIR_CLAIM_PREFIX + claimCode)!)
    expect(used.status).toBe("used")
    expect(used.appId).toBe(body.appId)
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

  it("redeemed token reaches the allowlisted sync routes", async () => {
    const kv = makeKv()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, owner)
    const redeem = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv),
    )
    const { pairingToken } = (await redeem.json()) as { pairingToken: string }

    const run = await app.request(
      "/api/sync/run",
      { method: "POST", headers: { Authorization: `Bearer ${pairingToken}` } },
      env(kv),
    )
    expect(run.status).toBe(200)
    const status = await app.request(
      "/api/sync/status",
      { headers: { Authorization: `Bearer ${pairingToken}` } },
      env(kv),
    )
    expect(status.status).toBe(200)
  })

  it("second redeem of the same claim -> 409 CLAIM_ALREADY_USED", async () => {
    const kv = makeKv()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, owner)

    const first = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv),
    )
    expect(first.status).toBe(200)

    const second = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv),
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
      env(kv),
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "CLAIM_NOT_FOUND",
    )
  })

  it("normalizes an ambiguously-typed claim code (O->0, I/L->1, lowercase)", async () => {
    const kv = makeKv()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, owner)
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
      env(kv),
    )
    expect(res.status).toBe(200)
  })
})

describe("POST /api/pair/revoke (owner)", () => {
  it("revokes a paired app; the app token is then rejected as AUTH_REVOKED", async () => {
    const kv = makeKv()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, owner)
    const redeem = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv),
    )
    const { pairingToken, appId } = (await redeem.json()) as { pairingToken: string; appId: string }

    const revoke = await app.request(
      "/api/pair/revoke",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      },
      env(kv),
    )
    expect(revoke.status).toBe(200)

    const after = await app.request(
      "/api/sync/status",
      { headers: { Authorization: `Bearer ${pairingToken}` } },
      env(kv),
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
      env(kv),
    )
    expect(res.status).toBe(404)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("APP_NOT_PAIRED")
  })
})

describe("TTL guarantees (Fix A/B)", () => {
  it("app-record puts (redeem + revoke) carry PAIR_APP_TTL_SEC == token TTL", async () => {
    expect(PAIR_APP_TTL_SEC).toBe(PAIR_TOKEN_TTL_SEC)

    const kv = makeKv()
    const app = pairApp()
    const owner = await makeToken(kv, "owner", "owner")
    const { claimCode } = await issue(app, kv, owner)
    const redeem = await app.request(
      "/api/pair/redeem",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimCode }),
      },
      env(kv),
    )
    const { appId } = (await redeem.json()) as { appId: string }
    await app.request(
      "/api/pair/revoke",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${owner}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      },
      env(kv),
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
