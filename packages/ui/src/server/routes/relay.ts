/**
 * Relay health check routes (Hono)
 *
 * Provides endpoint for checking firela-relay service health,
 * including availability, latency, and configuration status.
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import { RelayClient, maskApiKey } from "@firela/billclaw-core/relay"

import { DEFAULT_RELAY_URL } from "../constants.js"
import { getRelayApiKey } from "../lib/relay-helpers.js"
import { isApp } from "../middleware/auth.js"
import type { Env } from "../index.js"

export const relayRoutes = new Hono<{ Bindings: Env }>()

/**
 * Create a connect session on the relay server
 *
 * Proxies session creation to avoid CORS issues when calling relay from browser.
 * The browser cannot POST directly to the relay due to cross-origin restrictions,
 * so this endpoint acts as a server-side proxy.
 *
 * Request body:
 * - provider: "gmail" | "gocardless" | "plaid"
 * - code_challenge: PKCE code challenge (base64url-encoded SHA-256 hash)
 * - code_challenge_method: "S256"
 *
 * Response:
 * - success: boolean
 * - data: { session_id: string }
 */
relayRoutes.post("/connect/session", async (c) => {
  try {
    const apiKey = await getRelayApiKey(c.env)
    if (!apiKey) {
      return c.json(
        { success: false, error: "Relay not configured" },
        503,
      )
    }

    const body = await c.req.json<{
      provider?: string
      code_challenge?: string
      code_challenge_method?: string
      return_url?: string
    }>()

    if (!body.provider || !body.code_challenge) {
      return c.json(
        { success: false, error: "Missing provider or code_challenge" },
        400,
      )
    }

    const relayUrl = c.env.FIRELA_RELAY_URL || DEFAULT_RELAY_URL
    const relayRes = await fetch(`${relayUrl}/api/connect/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        provider: body.provider,
        code_challenge: body.code_challenge,
        code_challenge_method: body.code_challenge_method || "S256",
        return_url: body.return_url,
      }),
    })

    const data = await relayRes.json() as Record<string, unknown>

    if (!relayRes.ok) {
      return c.json(
        { success: false, error: data.error || "Relay session creation failed" },
        relayRes.status as 400,
      )
    }

    return c.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relay session creation failed"
    console.error("[relay_connect_session]", error)
    return c.json({ success: false, error: message }, 500)
  }
})

/**
 * Create a RelayClient from environment bindings or KV-stored key.
 *
 * @param env - Server environment bindings
 * @returns Configured RelayClient instance
 */
async function getRelayClient(env: Env): Promise<RelayClient> {
  const apiKey = await getRelayApiKey(env)
  return new RelayClient({
    url: env.FIRELA_RELAY_URL || DEFAULT_RELAY_URL,
    apiKey: apiKey!,
  })
}

/**
 * GET /api/relay/health
 *
 * Check relay service health and configuration status.
 *
 * If relay is not configured (no API key), returns configured: false.
 * Otherwise, performs a health check against the relay service and returns
 * availability, latency, and masked API key.
 */
relayRoutes.get("/health", async (c) => {
  try {
    const apiKey = await getRelayApiKey(c.env)

    // Check if relay is configured
    if (!apiKey) {
      return c.json({
        success: true,
        data: {
          available: false,
          configured: false,
          error: "Relay not configured",
        },
      })
    }

    const client = await getRelayClient(c.env)
    const health = await client.healthCheck()

    return c.json({
      success: true,
      data: {
        available: health.available,
        configured: true,
        latency: health.latency,
        error: health.error,
        relayUrl: c.env.FIRELA_RELAY_URL || DEFAULT_RELAY_URL,
        apiKeyMasked: maskApiKey(apiKey),
        lastChecked: new Date().toISOString(),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Relay health check failed"
    console.error("[relay_health]", error)

    return c.json(
      {
        success: false,
        error: message,
      },
      500,
    )
  }
})

/**
 * GET /api/relay/connect/credentials/:sessionId
 *
 * Proxy credential retrieval from relay to avoid CORS issues.
 * Called by the browser after the user completes authorization on the relay.
 *
 * Query params:
 * - code_verifier: PKCE code verifier for credential decryption
 *
 * Response: Proxied from relay (success + credential data, or 410 if expired)
 */
relayRoutes.get("/connect/credentials/:sessionId", async (c) => {
  try {
    const apiKey = await getRelayApiKey(c.env)
    if (!apiKey) {
      return c.json({ success: false, error: "Relay not configured" }, 503)
    }

    const sessionId = c.req.param("sessionId")
    const codeVerifier = c.req.query("code_verifier")

    if (!codeVerifier) {
      return c.json({ success: false, error: "Missing code_verifier" }, 400)
    }

    const relayUrl = c.env.FIRELA_RELAY_URL || DEFAULT_RELAY_URL
    const relayRes = await fetch(
      `${relayUrl}/api/connect/credentials/${sessionId}?code_verifier=${encodeURIComponent(codeVerifier)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    )

    const data = await relayRes.json() as Record<string, unknown>
    // App-role callers get a bare completion signal: credential custody stays
    // relay/Worker-side (ADR-009) — the native app polls for readiness and
    // discards the body by design, so the credential payload is stripped
    // rather than trusted to client discipline. Owner (SPA) keeps the proxy
    // verbatim.
    if (relayRes.ok && isApp(c)) {
      return c.json({ success: data.success ?? true }, relayRes.status as 200)
    }
    return c.json(data, relayRes.status as 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Credential retrieval failed"
    console.error("[relay_connect_credentials]", error)
    return c.json({ success: false, error: message }, 500)
  }
})
