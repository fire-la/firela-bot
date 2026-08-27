/**
 * Unit tests for the app-role credential-payload strip on
 * GET /api/relay/connect/credentials/:sessionId (ADR-009 custody: the
 * native app polls for readiness only; owner SPA keeps the verbatim proxy).
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getRelayApiKey: vi.fn() }))
vi.mock("../lib/relay-helpers.js", () => ({
  getRelayApiKey: mocks.getRelayApiKey,
}))

import { Hono } from "hono"
import { relayRoutes } from "./relay.js"

// Mirrors what the auth middleware does for each role before the route runs.
function appWithRole(role: "owner" | "app") {
  const app = new Hono()
  app.use("/api/relay/*", async (c, next) => {
    c.set("jwtPayload", { sub: "x", role })
    await next()
  })
  app.route("/api/relay", relayRoutes)
  return app
}

const credentialBody = {
  success: true,
  data: { access_token: "SECRET", identity: { email: "u@example.com" } },
}

const relayEnv = { FIRELA_RELAY_URL: "https://relay.test" } as never

const originalFetch = globalThis.fetch

describe("GET /api/relay/connect/credentials/:sessionId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRelayApiKey.mockResolvedValue("relay-key")
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => credentialBody,
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("app role: 2xx body is stripped to a bare completion signal", async () => {
    const res = await appWithRole("app").request(
      "/api/relay/connect/credentials/sess-1?code_verifier=v",
      undefined,
      relayEnv,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ success: true })
    expect(JSON.stringify(body)).not.toContain("SECRET")
  })

  it("owner role: relay payload proxied verbatim", async () => {
    const res = await appWithRole("owner").request(
      "/api/relay/connect/credentials/sess-1?code_verifier=v",
      undefined,
      relayEnv,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(credentialBody)
  })

  it("non-2xx (410 expired) passes through untouched for both roles", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({ success: false, error: "expired" }),
    }) as unknown as typeof fetch
    for (const role of ["app", "owner"] as const) {
      const res = await appWithRole(role).request(
        "/api/relay/connect/credentials/sess-1?code_verifier=v",
        undefined,
        relayEnv,
      )
      expect(res.status).toBe(410)
      expect(await res.json()).toEqual({ success: false, error: "expired" })
    }
  })
})
