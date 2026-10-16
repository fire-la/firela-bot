/**
 * Unit tests for webhook routes — createPlaidVerifier wiring
 *
 * Tests the RelayClient-backed JWK fetch integration:
 * - RelayClient is constructed with env credentials
 * - fetchVerificationKey calls correct relay proxy endpoint
 * - RelayJwkProxyResponse is mapped correctly to { key }
 * - Fail-closed behavior when RelayClient throws
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock RelayClient before importing the module under test
const mockRequest = vi.fn()
vi.mock("@firela/billclaw-core/relay", () => ({
  RelayClient: vi.fn().mockImplementation((config: { url: string; apiKey: string }) => {
    // Capture constructor args for assertions
    mockRequest._constructorArgs = config
    return {
      request: mockRequest,
      healthCheck: vi.fn(),
    }
  }),
}))

// Mock the sync job so the webhook trigger is observable in isolation
const mockRunSyncJob = vi.fn().mockResolvedValue(undefined)
vi.mock("../jobs/sync-job.js", () => ({
  runSyncJob: mockRunSyncJob,
}))

// Mock PlaidWebhookVerifier to capture the fetchVerificationKey callback
const mockVerify = vi.fn()
vi.mock("@firela/billclaw-core", () => ({
  PlaidWebhookVerifier: vi.fn().mockImplementation(
    (_logger: unknown, fetchVerificationKey: (kid: string) => Promise<{ key: unknown }>) => {
      mockVerify._fetchVerificationKey = fetchVerificationKey
      return {
        verify: mockVerify,
      }
    },
  ),
}))

// Import after mocks are set up
import { RelayClient } from "@firela/billclaw-core/relay"
import { createPlaidVerifier, webhookRoutes } from "./webhooks.js"
import type { RelayJwkProxyResponse } from "@firela/billclaw-core/relay"

const mockEnv = {
  DB: {} as unknown as D1Database,
  CONFIG: {
    get: vi.fn().mockResolvedValue("relay-api-key-12345"),
  } as unknown as KVNamespace,
  PLAID_ENV: "sandbox",
  JWT_SECRET: "test-jwt-secret",
  FIRELA_RELAY_URL: "https://relay.example.com",
}

describe("createPlaidVerifier", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates RelayClient with KV credentials", async () => {
    await createPlaidVerifier(mockEnv)

    expect(RelayClient).toHaveBeenCalledWith({
      url: mockEnv.FIRELA_RELAY_URL,
      apiKey: "relay-api-key-12345",
    })
  })

  it("fetchVerificationKey calls relay proxy endpoint with correct kid", async () => {
    const mockKeyResponse: RelayJwkProxyResponse = {
      key: {
        kid: "test-kid-123",
        kty: "EC",
        alg: "ES256",
        use: "sig",
        crv: "P-256",
        x: "test-x-coordinate",
        y: "test-y-coordinate",
        created_at: 1700000000,
        expired_at: null,
      },
    }
    mockRequest.mockResolvedValue(mockKeyResponse)

    await createPlaidVerifier(mockEnv)

    // Call the captured fetchVerificationKey callback
    const fetchKey = mockVerify._fetchVerificationKey as (
      kid: string,
    ) => Promise<{ key: unknown }>
    const result = await fetchKey("test-kid-123")

    expect(mockRequest).toHaveBeenCalledWith(
      "/api/open-banking/plaid/webhook-key/test-kid-123",
    )
    expect(result).toEqual({ key: mockKeyResponse.key })
  })

  it("maps RelayJwkProxyResponse key to { key: response.key }", async () => {
    const mockKeyResponse: RelayJwkProxyResponse = {
      key: {
        kid: "another-kid",
        kty: "EC",
        alg: "ES256",
        use: "sig",
        crv: "P-256",
        x: "x-value",
        y: "y-value",
        created_at: 1700000000,
        expired_at: 1735689600,
      },
    }
    mockRequest.mockResolvedValue(mockKeyResponse)

    await createPlaidVerifier(mockEnv)

    const fetchKey = mockVerify._fetchVerificationKey as (
      kid: string,
    ) => Promise<{ key: unknown }>
    const result = await fetchKey("another-kid")

    expect(result.key).toBe(mockKeyResponse.key)
  })

  it("propagates error when RelayClient.request throws (fail-closed)", async () => {
    const relayError = new Error("HTTP 404: key not found")
    mockRequest.mockRejectedValue(relayError)

    await createPlaidVerifier(mockEnv)

    const fetchKey = mockVerify._fetchVerificationKey as (
      kid: string,
    ) => Promise<{ key: unknown }>

    await expect(fetchKey("unknown-kid")).rejects.toThrow(
      "HTTP 404: key not found",
    )
  })

  it("propagates network error when RelayClient.request fails (fail-closed)", async () => {
    const networkError = new Error("ECONNREFUSED")
    mockRequest.mockRejectedValue(networkError)

    await createPlaidVerifier(mockEnv)

    const fetchKey = mockVerify._fetchVerificationKey as (
      kid: string,
    ) => Promise<{ key: unknown }>

    await expect(fetchKey("any-kid")).rejects.toThrow("ECONNREFUSED")
  })
})

describe("POST /webhook/plaid sync trigger (issue #33)", () => {
  const kv = new Map<string, string>()
  const waitUntilPromises: Promise<unknown>[] = []
  const mockCtx = {
    waitUntil: (p: Promise<unknown>) => waitUntilPromises.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext

  const triggerEnv = {
    DB: {} as unknown as D1Database,
    CONFIG: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kv.set(key, value)
      }),
    } as unknown as KVNamespace,
    PLAID_ENV: "sandbox",
    FIRELA_RELAY_URL: "https://relay.example.com",
  }

  async function postWebhook(headers: Record<string, string>) {
    return webhookRoutes.request(
      "/plaid",
      {
        method: "POST",
        body: JSON.stringify({ webhook_type: "TRANSACTIONS", item_id: "item-1" }),
        headers: { "content-type": "application/json", ...headers },
      },
      triggerEnv as never,
      mockCtx,
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    kv.clear()
    kv.set("firela:relay:api_key", "relay-api-key-12345") // createPlaidVerifier builds a RelayClient
    waitUntilPromises.length = 0
    mockVerify.mockResolvedValue(true)
  })

  it("a signature-verified webhook fires the debounced sync (after the response, via waitUntil)", async () => {
    const res = await postWebhook({ "Plaid-Verification": "jwt-token" })
    expect(res.status).toBe(200)

    await Promise.all(waitUntilPromises)
    expect(kv.get("firela:sync:webhook_debounce")).toBe("1")
    expect(mockRunSyncJob).toHaveBeenCalledTimes(1)
    expect(mockRunSyncJob).toHaveBeenCalledWith(triggerEnv)
  })

  it("a second webhook inside the 60s debounce window does not re-fire sync", async () => {
    kv.set("firela:sync:webhook_debounce", "1") // gate already armed
    const res = await postWebhook({ "Plaid-Verification": "jwt-token" })
    expect(res.status).toBe(200)

    await Promise.all(waitUntilPromises)
    expect(mockRunSyncJob).not.toHaveBeenCalled()
  })

  it("an invalid signature returns 401 and never fires sync", async () => {
    mockVerify.mockResolvedValue(false)
    const res = await postWebhook({ "Plaid-Verification": "forged-jwt" })
    expect(res.status).toBe(401)

    await Promise.all(waitUntilPromises)
    expect(mockRunSyncJob).not.toHaveBeenCalled()
  })

  it("the sandbox unsigned-allow branch (unauthenticated) never fires sync", async () => {
    const res = await postWebhook({}) // no Plaid-Verification header
    expect(res.status).toBe(200) // sandbox accepts unsigned

    await Promise.all(waitUntilPromises)
    expect(mockRunSyncJob).not.toHaveBeenCalled()
    expect(kv.has("firela:sync:webhook_debounce")).toBe(false)
  })

  it("a verified non-TRANSACTIONS webhook (e.g. PING) does not fire sync", async () => {
    const res = await webhookRoutes.request(
      "/plaid",
      {
        method: "POST",
        body: JSON.stringify({ webhook_type: "PING" }),
        headers: { "content-type": "application/json", "Plaid-Verification": "jwt" },
      },
      triggerEnv as never,
      mockCtx,
    )
    expect(res.status).toBe(200)

    await Promise.all(waitUntilPromises)
    expect(mockRunSyncJob).not.toHaveBeenCalled()
    expect(kv.has("firela:sync:webhook_debounce")).toBe(false)
  })

  it("absent ExecutionContext (no mock ctx) still returns 200 without the trigger", async () => {
    const res = await webhookRoutes.request(
      "/plaid",
      {
        method: "POST",
        body: JSON.stringify({ webhook_type: "TRANSACTIONS" }),
        headers: { "content-type": "application/json", "Plaid-Verification": "jwt" },
      },
      triggerEnv as never,
      // deliberately no 4th argument — Hono's executionCtx getter throws
    )
    expect(res.status).toBe(200)
    expect(mockRunSyncJob).not.toHaveBeenCalled()
  })
})
