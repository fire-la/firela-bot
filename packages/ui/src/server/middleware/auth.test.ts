/**
 * JWT Authentication Middleware Tests
 *
 * Verifies that auth middleware correctly protects API routes
 * and allows public routes through. Addresses GitHub Issue #6
 * (OAuth middleware ordering).
 */
import { describe, it, expect } from "vitest"
import { Hono } from "hono"
import { sign } from "hono/jwt"

import { authMiddleware } from "./auth.js"
import { AUTH_SECRET_KEY, PAIR_APP_PREFIX } from "../constants.js"
import type { Env } from "../index.js"

/**
 * Create a minimal Hono app with authMiddleware applied to /api/*
 * mirroring the production setup in server/index.ts
 */
function createTestApp(envOverrides?: Partial<Env>) {
  type TestEnv = { Bindings: Env }
  const app = new Hono<TestEnv>()

  const testEnv: Env = {
    DB: {} as D1Database,
    CONFIG: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as KVNamespace,
    PLAID_ENV: "sandbox",
    ...envOverrides,
  }

  app.use("*", async (c, next) => {
    // @ts-expect-error - Setting env for testing
    c.env = testEnv
    await next()
  })

  // Apply auth middleware to /api/* — same as production
  app.use("/api/*", authMiddleware)

  // Public routes (no auth required)
  app.get("/health", (c) => c.json({ status: "ok" }))
  app.post("/auth/setup", (c) => c.json({ success: true }))
  app.post("/webhook/plaid", (c) => c.json({ received: true }))

  // Protected API routes
  app.get("/api/oauth/plaid/link-token", (c) =>
    c.json({ success: true, linkToken: "link-sandbox-123" }),
  )
  app.post("/api/oauth/plaid/exchange", (c) =>
    c.json({ success: true, accessToken: "access-123" }),
  )
  app.get("/api/accounts", (c) => c.json({ accounts: [] }))
  app.get("/api/config", (c) => c.json({ config: {} }))

  return app
}

describe("authMiddleware", () => {
  describe("public routes (no auth required)", () => {
    const app = createTestApp()

    it("should allow /health without auth", async () => {
      const res = await app.request("/health")
      expect(res.status).toBe(200)
    })

    it("should allow /auth/* without auth", async () => {
      const res = await app.request("/auth/setup", { method: "POST" })
      expect(res.status).toBe(200)
    })

    it("should allow /webhook/* without auth", async () => {
      const res = await app.request("/webhook/plaid", { method: "POST" })
      expect(res.status).toBe(200)
    })
  })

  describe("protected API routes (auth required)", () => {
    const app = createTestApp()

    it("should return 401 for /api/oauth/plaid/link-token without token", async () => {
      const res = await app.request("/api/oauth/plaid/link-token")
      expect(res.status).toBe(401)
      const json = (await res.json()) as { errorCode: string }
      expect(json.errorCode).toBe("AUTH_MISSING")
    })

    it("should return 401 for /api/oauth/plaid/exchange without token", async () => {
      const res = await app.request("/api/oauth/plaid/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicToken: "test" }),
      })
      expect(res.status).toBe(401)
      const json = (await res.json()) as { errorCode: string }
      expect(json.errorCode).toBe("AUTH_MISSING")
    })

    it("should return 401 for /api/accounts without token", async () => {
      const res = await app.request("/api/accounts")
      expect(res.status).toBe(401)
    })

    it("should return 401 with invalid Bearer token", async () => {
      const res = await app.request("/api/oauth/plaid/link-token", {
        headers: { Authorization: "Bearer invalid-token" },
      })
      expect(res.status).toBe(401)
      const json = (await res.json()) as { errorCode: string }
      expect(json.errorCode).toBe("AUTH_INVALID")
    })
  })

  describe("without JWT_SECRET configured (auto-generates from KV)", () => {
    it("should return 401 when JWT_SECRET is empty (auto-generated secret protects routes)", async () => {
      const app = createTestApp({
        JWT_SECRET: "",
        CONFIG: {
          get: async () => null,
          put: async () => undefined,
        } as unknown as KVNamespace,
      })

      const res = await app.request("/api/oauth/plaid/link-token")
      // JWT_SECRET is auto-generated from KV, so routes are still protected
      expect(res.status).toBe(401)
    })
  })
})

describe("authMiddleware role enforcement (PR-3)", () => {
  const TEST_SECRET = "test-secret-0123456789abcdef0123456789abcdef"

  /**
   * KV fake: seeds the JWT secret (so ensureAuthSecret is deterministic); optionally
   * seeds a pairing record; can throw on the pairing-key read for the fail-closed test.
   */
  function roleKv(opts: { appId?: string; revoked?: boolean; throwPairGet?: boolean } = {}) {
    const store = new Map<string, string>()
    store.set(AUTH_SECRET_KEY, TEST_SECRET)
    if (opts.appId) {
      store.set(
        PAIR_APP_PREFIX + opts.appId,
        JSON.stringify({ appId: opts.appId, pairedAt: 1, revoked: !!opts.revoked }),
      )
    }
    return {
      async get(key: string, o?: unknown) {
        if (opts.throwPairGet && key.startsWith(PAIR_APP_PREFIX)) {
          throw new Error("KV down")
        }
        const raw = store.get(key)
        if (raw == null) return null
        if (o === "json") {
          try {
            return JSON.parse(raw)
          } catch {
            return null
          }
        }
        return raw
      },
      async put() {},
    }
  }

  type RoleKv = ReturnType<typeof roleKv>

  /** App mirroring index.ts: authMiddleware on /api/* + representative routes. */
  function roleApp() {
    const app = new Hono<{ Bindings: Env }>()
    app.use("/api/*", authMiddleware)
    // allowlisted app reads + sync
    app.post("/api/sync/run", (c) => c.json({ ok: true }))
    app.get("/api/sync/status", (c) => c.json({ ok: true }))
    app.get("/api/accounts", (c) => c.json({ ok: true }))
    app.get("/api/config", (c) => c.json({ ok: true }))
    app.get("/api/services", (c) => c.json({ ok: true }))
    app.get("/api/cloudflare/version", (c) => c.json({ ok: true }))
    // owner-only / credential-mint (app must be denied)
    app.put("/api/config", (c) => c.json({ ok: true }))
    app.put("/api/settings/password", (c) => c.json({ ok: true }))
    app.get("/api/oauth/plaid/link-token", (c) => c.json({ ok: true }))
    app.post("/api/oauth/plaid/exchange", (c) => c.json({ ok: true }))
    app.post("/api/connect/session", (c) => c.json({ ok: true }))
    app.post("/api/cloudflare/upgrade", (c) => c.json({ ok: true }))
    // public
    app.get("/api/relay/health", (c) => c.json({ ok: true }))
    app.post("/api/pair/redeem", (c) => c.json({ reached: true })) // public stub
    app.post("/api/pair/issue", (c) => c.json({ reached: true })) // protected stub
    return app
  }

  const envOf = (kv: RoleKv) => ({ CONFIG: kv }) as never
  const nowSec = () => Math.floor(Date.now() / 1000)
  const jwt = (payload: Record<string, unknown>): Promise<string> =>
    sign({ iat: nowSec(), exp: nowSec() + 3600, ...payload }, TEST_SECRET, "HS256")
  const algNoneToken = (payload: Record<string, unknown>): string => {
    const enc = (o: unknown) => btoa(JSON.stringify(o))
    return `${enc({ alg: "none", typ: "JWT" })}.${enc({ iat: nowSec(), exp: nowSec() + 3600, ...payload })}.`
  }
  const bearer = (tok: string) => ({ Authorization: `Bearer ${tok}` })

  it("app token reaches the allowlisted sync routes (200)", async () => {
    const kv = roleKv({ appId: "app-1" })
    const app = roleApp()
    const tok = await jwt({ sub: "app-1", role: "app" })
    expect(
      (await app.request("/api/sync/run", { method: "POST", headers: bearer(tok) }, envOf(kv)))
        .status,
    ).toBe(200)
    expect(
      (await app.request("/api/sync/status", { headers: bearer(tok) }, envOf(kv))).status,
    ).toBe(200)
  })

  it("app token: allowlisted READs -> 200 (method-aware)", async () => {
    const kv = roleKv({ appId: "app-1" })
    const app = roleApp()
    const tok = await jwt({ sub: "app-1", role: "app" })
    for (const path of ["/api/config", "/api/accounts", "/api/services", "/api/cloudflare/version"]) {
      expect((await app.request(path, { headers: bearer(tok) }, envOf(kv))).status).toBe(200)
    }
  })

  it("app token: method mismatch on a shared path -> 403 (GET /api/config ok, PUT denied)", async () => {
    const kv = roleKv({ appId: "app-1" })
    const app = roleApp()
    const tok = await jwt({ sub: "app-1", role: "app" })
    expect((await app.request("/api/config", { headers: bearer(tok) }, envOf(kv))).status).toBe(200)
    const put = await app.request("/api/config", { method: "PUT", headers: bearer(tok) }, envOf(kv))
    expect(put.status).toBe(403)
    expect(((await put.json()) as { errorCode: string }).errorCode).toBe("APP_ROLE_PATH_DENIED")
  })

  it("app token: credential-mint + infra + connect-init denied (403, no dead-end)", async () => {
    const kv = roleKv({ appId: "app-1" })
    const app = roleApp()
    const tok = await jwt({ sub: "app-1", role: "app" })
    // GET init denied too — bank-connect is fully owner-only (no half-connected flow)
    for (const path of ["/api/oauth/plaid/link-token", "/api/cache", "/api/cloudflare"]) {
      expect((await app.request(path, { headers: bearer(tok) }, envOf(kv))).status).toBe(403)
    }
    for (const path of ["/api/oauth/plaid/exchange", "/api/connect/session", "/api/cloudflare/upgrade"]) {
      expect(
        (await app.request(path, { method: "POST", headers: bearer(tok) }, envOf(kv))).status,
      ).toBe(403)
    }
    expect(
      (await app.request("/api/settings/password", { method: "PUT", headers: bearer(tok) }, envOf(kv)))
        .status,
    ).toBe(403)
  })

  it("app token cannot bypass via prefix: /api/sync/runXXX is denied (403)", async () => {
    const kv = roleKv({ appId: "app-1" })
    const app = roleApp()
    const tok = await jwt({ sub: "app-1", role: "app" })
    const res = await app.request("/api/sync/runXXX", { headers: bearer(tok) }, envOf(kv))
    expect(res.status).toBe(403)
  })

  it("revoked app token -> 401 AUTH_REVOKED", async () => {
    const kv = roleKv({ appId: "app-1", revoked: true })
    const res = await roleApp().request(
      "/api/sync/status",
      { headers: bearer(await jwt({ sub: "app-1", role: "app" })) },
      envOf(kv),
    )
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("AUTH_REVOKED")
  })

  it("app token with no pairing record -> 401 APP_NOT_PAIRED", async () => {
    const kv = roleKv() // no appId seeded
    const res = await roleApp().request(
      "/api/sync/status",
      { headers: bearer(await jwt({ sub: "app-9", role: "app" })) },
      envOf(kv),
    )
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("APP_NOT_PAIRED")
  })

  it("KV revocation read throws -> 401 AUTH_REVOCATION_CHECK_FAILED (fail-closed)", async () => {
    const kv = roleKv({ appId: "app-1", throwPairGet: true })
    const res = await roleApp().request(
      "/api/sync/status",
      { headers: bearer(await jwt({ sub: "app-1", role: "app" })) },
      envOf(kv),
    )
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "AUTH_REVOCATION_CHECK_FAILED",
    )
  })

  it("unknown role -> 403 AUTH_INVALID_ROLE", async () => {
    const res = await roleApp().request(
      "/api/sync/run",
      { method: "POST", headers: bearer(await jwt({ sub: "x", role: "superuser" })) },
      envOf(roleKv()),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("AUTH_INVALID_ROLE")
  })

  it("missing role -> 403 AUTH_INVALID_ROLE", async () => {
    const res = await roleApp().request(
      "/api/sync/run",
      { method: "POST", headers: bearer(await jwt({ sub: "x" })) }, // no role field
      envOf(roleKv()),
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("AUTH_INVALID_ROLE")
  })

  it("alg:none forgery -> 401 AUTH_INVALID", async () => {
    const res = await roleApp().request(
      "/api/config",
      { headers: bearer(algNoneToken({ sub: "owner", role: "owner" })) },
      envOf(roleKv()),
    )
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("AUTH_INVALID")
  })

  it("owner token reaches owner-only routes (skips revocation)", async () => {
    const res = await roleApp().request(
      "/api/config",
      { headers: bearer(await jwt({ sub: "owner", role: "owner" })) },
      envOf(roleKv()), // no pairing record — owner doesn't need one
    )
    expect(res.status).toBe(200)
  })

  it("/api/pair/redeem is public (no token) -> reaches handler", async () => {
    const res = await roleApp().request("/api/pair/redeem", { method: "POST" }, envOf(roleKv()))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { reached: boolean }).reached).toBe(true)
  })

  it("/api/relay/health is public (no token) -> 200 (pre-login probe)", async () => {
    const res = await roleApp().request("/api/relay/health", {}, envOf(roleKv()))
    expect(res.status).toBe(200)
  })

  it("/api/pair/redeemXXX is NOT public -> auth enforced (401, handler not leaked)", async () => {
    const res = await roleApp().request(
      "/api/pair/redeemXXX",
      { method: "POST" },
      envOf(roleKv()),
    )
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("AUTH_MISSING")
  })

  it("/api/pair/redeem/../issue -> traversal collapsed to /issue -> auth enforced (401)", async () => {
    const res = await roleApp().request(
      "/api/pair/redeem/../issue",
      { method: "POST" },
      envOf(roleKv()),
    )
    expect(res.status).toBe(401)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe("AUTH_MISSING")
  })
})
