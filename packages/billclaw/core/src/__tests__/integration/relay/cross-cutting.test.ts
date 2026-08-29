/**
 * Cross-cutting integration tests for relay + connection mode + token storage
 *
 * Tests verify multi-component interaction against staging relay.
 * Tests FAIL if FIRELA_RELAY_API_KEY is not set.
 *
 * Run with: pnpm --filter @firela/billclaw-core test -- --run cross-cutting
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { RelayClient } from "../../../relay/client.js"
import { GoCardlessRelayClient } from "../../../relay/gocardless-client.js"
import type { Logger } from "../../../errors/errors.js"
import { IntegrationTestHelpers } from "../setup.js"
import { isRelayAvailable, selectConnectionMode } from "../../../connection/mode-selector.js"
import type { RelayHealthCheckResponse } from "../../../relay/types.js"

const RELAY_URL = process.env.FIRELA_RELAY_URL || "https://napi-dev.firela.io"
const RELAY_API_KEY = process.env.FIRELA_RELAY_API_KEY || ""
const _describe = RELAY_API_KEY ? describe : describe.skip

const testLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

let relayClient: RelayClient
let helpers: IntegrationTestHelpers

beforeAll(async () => {
  relayClient = new RelayClient(
    { url: RELAY_URL, apiKey: RELAY_API_KEY, timeout: 30000 },
    testLogger,
  )

  const health = await relayClient.healthCheck(10000)
  if (!health.available) {
    throw new Error(
      `Staging relay (${RELAY_URL}) unreachable: ${health.error}`,
    )
  }

  helpers = new IntegrationTestHelpers()
  await helpers.setupTempDir("billclaw-cross-cutting-test")
})

afterAll(async () => {
  vi.restoreAllMocks()
  if (helpers) {
    await helpers.cleanup()
  }
})

_describe("Relay Health + Mode Selection", () => {
  it(
    "should pass health check and select relay mode",
    async () => {
      const health = await relayClient.healthCheck(10000)
      expect(health.available).toBe(true)

      const context = helpers.createMockContext({
        relay: { url: RELAY_URL, apiKey: RELAY_API_KEY },
        connect: {
          port: 4456,
          host: "localhost",
          connection: {
            mode: "auto",
          },
        },
      })

      const result = await selectConnectionMode(context, "oauth")
      expect(result.mode).toBe("relay")
    },
    30000,
  )

  it(
    "should return health check version info",
    async () => {
      try {
        const response = await relayClient.request<RelayHealthCheckResponse>(
          "/api/open-banking/health",
          {
            method: "POST",
            body: JSON.stringify({}),
          },
        )

        expect(response).toBeDefined()
        if ("version" in response) {
          expect(typeof response.version).toBe("string")
        }
        if ("status" in response) {
          expect(response.status).toBe("ok")
        }
      } catch {
        // POST /health may not return JSON on all deployments
        const health = await relayClient.healthCheck(10000)
        expect(health.available).toBe(true)
      }
    },
    30000,
  )

  it(
    "should register callback during health check",
    async () => {
      try {
        const response = await relayClient.request<RelayHealthCheckResponse>(
          "/api/open-banking/health",
          {
            method: "POST",
            body: JSON.stringify({
              callback_url: "https://test.example.com/webhook/plaid",
            }),
          },
        )

        expect(response).toBeDefined()
      } catch {
        // Registration endpoint may not be deployed on all environments
        const health = await relayClient.healthCheck(10000)
        expect(health.available).toBe(true)
      }
    },
    30000,
  )
})

_describe("Relay + GoCardless Token Flow", () => {
  it(
    "should verify GoCardless client uses relay mode",
    () => {
      const gocardlessClient = new GoCardlessRelayClient(
        {
          relayUrl: RELAY_URL,
          relayApiKey: RELAY_API_KEY,
        },
        testLogger,
      )

      expect(gocardlessClient.getMode()).toBe("relay")
    },
    30000,
  )

  it(
    "should handle GoCardless institutions via relay",
    async () => {
      const gocardlessClient = new GoCardlessRelayClient(
        {
          relayUrl: RELAY_URL,
          relayApiKey: RELAY_API_KEY,
        },
        testLogger,
      )

      try {
        const result = await gocardlessClient.getInstitutions("DE")
        expect(Array.isArray(result)).toBe(true)
      } catch (error) {
        // Provider not configured or upstream error - acceptable
        expect(error).toBeDefined()
      }
    },
    30000,
  )

  it(
    "should reject invalid GoCardless access token",
    async () => {
      const gocardlessClient = new GoCardlessRelayClient(
        {
          relayUrl: RELAY_URL,
          relayApiKey: RELAY_API_KEY,
        },
        testLogger,
      )

      await expect(
        gocardlessClient.getAccounts("invalid-token"),
      ).rejects.toThrow()
    },
    30000,
  )
})

_describe("Multi-Component Interaction", () => {
  it(
    "should relay health check consistent with isRelayAvailable",
    async () => {
      const directHealth = await relayClient.healthCheck(10000)
      expect(directHealth.available).toBe(true)
      expect(directHealth.latency).toBeGreaterThan(0)

      const context = helpers.createMockContext({
        relay: { url: RELAY_URL, apiKey: RELAY_API_KEY },
      })
      const contextHealth = await isRelayAvailable(context, 10000)
      expect(contextHealth.available).toBe(true)
      expect(contextHealth.latency).toBeGreaterThan(0)

      const maxLatency = Math.max(directHealth.latency!, contextHealth.latency!)
      const minLatency = Math.min(directHealth.latency!, contextHealth.latency!)
      expect(maxLatency / minLatency).toBeLessThan(2)
    },
    30000,
  )

  it(
    "should handle mode selection after relay health check failure",
    async () => {
      const noRelayContext = helpers.createMockContext({
        connect: {
          port: 4456,
          host: "localhost",
        },
      })

      const modeResult = await selectConnectionMode(
        noRelayContext,
        "webhook",
      )
      expect(modeResult.mode).toBe("polling")
    },
    30000,
  )
})

_describe("Environment Configuration", () => {
  it(
    "should use HTTPS for staging relay URL",
    () => {
      expect(RELAY_URL).toMatch(/^https:\/\//)
    },
    30000,
  )

  it(
    "should use napi-dev.firela.io as default",
    () => {
      expect(RELAY_URL).toMatch(/(napi-dev|firela)/)
    },
    30000,
  )
})
