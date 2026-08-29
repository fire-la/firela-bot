/**
 * Unit tests for GET /api/oauth/plaid/link-token query validation (#28):
 * country_codes/products are allowlisted with defaults; invalid values
 * fail with 400 locally instead of a relay-proxied error.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getPlaidRelayClient: vi.fn(),
}))
vi.mock("../lib/plaid-relay.js", () => ({
  getPlaidRelayClient: mocks.getPlaidRelayClient,
}))

import { Hono } from "hono"
import { plaidRoutes } from "./oauth/plaid.js"

const app = new Hono()
app.route("/api/oauth/plaid", plaidRoutes)

const createLinkToken = vi.fn().mockResolvedValue({ link_token: "lt-1" })

function requestLinkToken(query = "") {
  return app.request(`/api/oauth/plaid/link-token${query}`, undefined, {})
}

/** Extract the request passed through to the relay client. */
async function relayRequest(query = "") {
  const res = await requestLinkToken(query)
  return {
    res,
    request: createLinkToken.mock.calls[0]?.[0] as Record<string, unknown>,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getPlaidRelayClient.mockResolvedValue({ createLinkToken })
})

describe("GET /api/oauth/plaid/link-token", () => {
  it("no params: defaults US / transactions", async () => {
    const { res, request } = await relayRequest()
    expect(res.status).toBe(200)
    expect(request.country_codes).toEqual(["US"])
    expect(request.products).toEqual(["transactions"])
  })

  it("country_codes=CA: forwarded to relay", async () => {
    const { res, request } = await relayRequest("?country_codes=CA")
    expect(res.status).toBe(200)
    expect(request.country_codes).toEqual(["CA"])
  })

  it("lowercase input is normalized", async () => {
    const { request } = await relayRequest("?country_codes=fr")
    expect(request.country_codes).toEqual(["FR"])
  })

  it("comma-separated list is trimmed and deduplicated", async () => {
    const { request } = await relayRequest("?country_codes=US, CA ,US")
    expect(request.country_codes).toEqual(["US", "CA"])
  })

  it("unsupported country code: 400, relay never called", async () => {
    const res = await requestLinkToken("?country_codes=XX")
    expect(res.status).toBe(400)
    expect(createLinkToken).not.toHaveBeenCalled()
  })

  it("products=transactions: accepted", async () => {
    const { res, request } = await relayRequest("?products=transactions")
    expect(res.status).toBe(200)
    expect(request.products).toEqual(["transactions"])
  })

  it("unsupported product: 400, relay never called", async () => {
    const res = await requestLinkToken("?products=assets")
    expect(res.status).toBe(400)
    expect(createLinkToken).not.toHaveBeenCalled()
  })

  it("unknown query keys (SPA session param) do not fail validation", async () => {
    const res = await requestLinkToken("?session=sess-1")
    expect(res.status).toBe(200)
  })
})
