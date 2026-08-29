/**
 * Unit tests for the external account link routes (issue #18 Tier 0).
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => {
  // Shared method stubs: each MockVltClient instance delegates to these, so
  // tests can configure/assert without reaching for the constructed instance.
  const vlt = {
    listExternalAccountLinks: vi.fn(),
    createExternalAccountLink: vi.fn(),
    deleteExternalAccountLink: vi.fn(),
    listBeanAccounts: vi.fn(),
  }
  class MockVltClient {
    static instances: Array<{ config: unknown }> = []
    config: unknown
    constructor(config: unknown) {
      this.config = config
      MockVltClient.instances.push(this)
    }
    listExternalAccountLinks = vlt.listExternalAccountLinks
    createExternalAccountLink = vlt.createExternalAccountLink
    deleteExternalAccountLink = vlt.deleteExternalAccountLink
    listBeanAccounts = vlt.listBeanAccounts
  }
  return {
    MockVltClient,
    vlt,
    getPlaidRelayClient: vi.fn(),
    getVltJwt: vi.fn(),
  }
})

vi.mock("../lib/plaid-relay.js", () => ({
  getPlaidRelayClient: mocks.getPlaidRelayClient,
}))
vi.mock("../lib/vlt-auth.js", () => ({ getVltJwt: mocks.getVltJwt }))
vi.mock("@firela/billclaw-core", () => ({ VltClient: mocks.MockVltClient }))

import { accountLinksRoutes } from "./account-links.js"

/** Minimal KV fake over a plain key -> parsed-JSON map. */
function makeEnv(kvs: Record<string, unknown>) {
  return {
    CONFIG: {
      get: vi.fn(async (key: string) => (key in kvs ? kvs[key] : null)),
      put: vi.fn(async () => {}),
    },
  }
}

const VLT_CONFIG = {
  vlt: {
    apiUrl: "https://vlt.example/api/v1",
    accessToken: "vlt-token",
    region: "de",
  },
}

function plaidItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Item ${id}`,
    provider: "plaid",
    type: "plaid",
    status: "connected",
    plaidAccessToken: `token-${id}`,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.MockVltClient.instances.length = 0
  mocks.getVltJwt.mockResolvedValue("jwt-token")
})

describe("GET /api/account-links/discover", () => {
  it("returns the empty state without touching the relay (fresh deployment)", async () => {
    const env = makeEnv({ "billclaw:accounts": [] })
    const res = await accountLinksRoutes.request("/discover", {}, env as never)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      data: { accounts: unknown[]; errors: unknown[] }
    }
    expect(body.success).toBe(true)
    expect(body.data.accounts).toEqual([])
    expect(body.data.errors).toEqual([])
    // Short-circuit: relay client must not be built (no relay key on a fresh box).
    expect(mocks.getPlaidRelayClient).not.toHaveBeenCalled()
  })

  it("merges discovered accounts across items with provenance", async () => {
    const getAccounts = vi
      .fn()
      .mockResolvedValueOnce({
        accounts: [
          {
            account_id: "ext-a1",
            name: "Checking",
            mask: "1234",
            type: "depository",
            subtype: "checking",
            balances: { current: 100, available: 90, iso_currency_code: "USD" },
          },
        ],
      })
      .mockResolvedValueOnce({
        accounts: [
          { account_id: "ext-b1", name: "", mask: "5678", type: "credit", balances: {} },
        ],
      })
    mocks.getPlaidRelayClient.mockResolvedValue({ getAccounts })

    const env = makeEnv({ "billclaw:accounts": [plaidItem("item-1"), plaidItem("item-2")] })
    const res = await accountLinksRoutes.request("/discover", {}, env as never)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: { accounts: Array<Record<string, unknown>>; errors: unknown[] }
    }
    expect(body.data.errors).toEqual([])
    expect(body.data.accounts).toHaveLength(2)

    const [a1, b1] = body.data.accounts
    expect(a1).toMatchObject({
      provider: "plaid",
      externalAccountId: "ext-a1",
      itemId: "item-1",
      itemName: "Item item-1",
      name: "Checking",
      currency: "USD",
      currentBalance: 100,
    })
    // Empty runtime name falls back to the mask despite the schema typing it required.
    expect(b1).toMatchObject({
      externalAccountId: "ext-b1",
      itemId: "item-2",
      name: "Plaid ••5678",
    })
  })

  it("reports a failed item in errors without failing the others", async () => {
    const getAccounts = vi
      .fn()
      .mockRejectedValueOnce(new Error("relay 503"))
      .mockResolvedValueOnce({
        accounts: [{ account_id: "ext-ok", name: "Savings", type: "depository" }],
      })
    mocks.getPlaidRelayClient.mockResolvedValue({ getAccounts })

    const env = makeEnv({ "billclaw:accounts": [plaidItem("bad"), plaidItem("good")] })
    const res = await accountLinksRoutes.request("/discover", {}, env as never)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: {
        accounts: Array<{ externalAccountId: string }>
        errors: Array<{ itemId: string; error: string }>
      }
    }
    expect(body.data.accounts.map((a) => a.externalAccountId)).toEqual(["ext-ok"])
    expect(body.data.errors).toEqual([
      { itemId: "bad", itemName: "Item bad", error: "relay 503" },
    ])
  })

  it("excludes disabled or disconnected items (same due-filter as the sync job)", async () => {
    const getAccounts = vi.fn()
    mocks.getPlaidRelayClient.mockResolvedValue({ getAccounts })

    const env = makeEnv({
      "billclaw:accounts": [
        plaidItem("disabled", { enabled: false }),
        plaidItem("disconnected", { status: "disconnected" }),
      ],
    })
    const res = await accountLinksRoutes.request("/discover", {}, env as never)

    expect(res.status).toBe(200)
    // Everything filtered out → empty short-circuit, relay untouched.
    expect(mocks.getPlaidRelayClient).not.toHaveBeenCalled()
    expect(getAccounts).not.toHaveBeenCalled()
  })

  it("returns 502 RELAY_ERROR when the relay client cannot be built", async () => {
    mocks.getPlaidRelayClient.mockRejectedValue(
      new Error("Relay API key not configured. Set it in Settings."),
    )

    const env = makeEnv({ "billclaw:accounts": [plaidItem("item-1")] })
    const res = await accountLinksRoutes.request("/discover", {}, env as never)

    expect(res.status).toBe(502)
    const body = (await res.json()) as { errorCode: string; error: string }
    expect(body.errorCode).toBe("RELAY_ERROR")
    expect(body.error).toContain("Relay API key not configured")
  })
})

describe("GET /api/account-links/bean-accounts", () => {
  it("returns 400 VLT_NOT_CONFIGURED without an access token", async () => {
    const env = makeEnv({
      "billclaw:config": { vlt: { apiUrl: "https://vlt.example/api/v1" } },
    })
    const res = await accountLinksRoutes.request("/bean-accounts", {}, env as never)

    expect(res.status).toBe(400)
    const body = (await res.json()) as { errorCode: string }
    expect(body.errorCode).toBe("VLT_NOT_CONFIGURED")
  })

  it("lists accounts through a VltClient built with the JWT and region", async () => {
    const accounts = [{ id: "bean-1", path: "Assets:Bank:Checking" }]
    mocks.vlt.listBeanAccounts.mockResolvedValue(accounts)

    const env = makeEnv({ "billclaw:config": VLT_CONFIG })
    const res = await accountLinksRoutes.request("/bean-accounts", {}, env as never)

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      data: { accounts: typeof accounts }
    }
    expect(body.success).toBe(true)
    expect(body.data.accounts).toEqual(accounts)
    expect(mocks.vlt.listBeanAccounts).toHaveBeenCalledTimes(1)

    // Client constructed with the cached JWT and the configured region.
    expect(mocks.getVltJwt).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        apiUrl: "https://vlt.example/api/v1",
        accessToken: "vlt-token",
        region: "de",
      }),
    )
    expect(mocks.MockVltClient.instances).toHaveLength(1)
    expect(mocks.MockVltClient.instances[0]!.config).toEqual({
      apiUrl: "https://vlt.example/api/v1",
      apiToken: "jwt-token",
      region: "de",
    })
  })
})

describe("GET /api/account-links", () => {
  it("lists active links for the pinned provider", async () => {
    const list = { items: [{ id: "link-1", provider: "plaid" }], total: 1 }
    mocks.vlt.listExternalAccountLinks.mockResolvedValue(list)

    const env = makeEnv({ "billclaw:config": VLT_CONFIG })
    const res = await accountLinksRoutes.request("/", {}, env as never)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: typeof list }
    expect(body.success).toBe(true)
    expect(body.data).toEqual(list)
    expect(mocks.vlt.listExternalAccountLinks).toHaveBeenCalledWith("plaid")
  })
})

describe("POST /api/account-links", () => {
  it("rejects a missing beanAccountId with 400", async () => {
    const env = makeEnv({ "billclaw:config": VLT_CONFIG })
    const res = await accountLinksRoutes.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalAccountId: "ext-1" }),
      },
      env,
    )

    expect(res.status).toBe(400)
    expect(mocks.vlt.createExternalAccountLink).not.toHaveBeenCalled()
  })

  it("creates a link with the server-pinned provider", async () => {
    const link = {
      id: "link-1",
      provider: "plaid",
      externalAccountId: "ext-1",
      beanAccountId: "bean-1",
    }
    mocks.vlt.createExternalAccountLink.mockResolvedValue(link)

    const env = makeEnv({ "billclaw:config": VLT_CONFIG })
    const res = await accountLinksRoutes.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalAccountId: "ext-1", beanAccountId: "bean-1" }),
      },
      env,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; data: typeof link }
    expect(body.success).toBe(true)
    expect(body.data).toEqual(link)
    expect(mocks.vlt.createExternalAccountLink).toHaveBeenCalledWith({
      provider: "plaid",
      externalAccountId: "ext-1",
      beanAccountId: "bean-1",
    })
  })

  it("returns 502 with the upstream message when vlt rejects", async () => {
    mocks.vlt.createExternalAccountLink.mockRejectedValue(
      new Error("VLT create external account link failed (422): not owned"),
    )

    const env = makeEnv({ "billclaw:config": VLT_CONFIG })
    const res = await accountLinksRoutes.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalAccountId: "ext-1", beanAccountId: "bean-1" }),
      },
      env,
    )

    expect(res.status).toBe(502)
    const body = (await res.json()) as { errorCode: string; error: string }
    expect(body.errorCode).toBe("VLT_UPSTREAM_ERROR")
    expect(body.error).toContain("422")
  })
})

describe("DELETE /api/account-links/:id", () => {
  it("deletes the link by id", async () => {
    const env = makeEnv({ "billclaw:config": VLT_CONFIG })
    const res = await accountLinksRoutes.request("/link-42", { method: "DELETE" }, env as never)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean }
    expect(body.success).toBe(true)
    expect(mocks.vlt.deleteExternalAccountLink).toHaveBeenCalledWith("link-42")
  })
})
