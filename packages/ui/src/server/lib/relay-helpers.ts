/**
 * Relay Helpers
 *
 * Utilities for relay API key management with KV-backed storage.
 * The relay API key is configured via the Settings UI and stored in KV.
 *
 * @packageDocumentation
 */

import { RelayClient } from "@firela/billclaw-core/relay"

import { DEFAULT_RELAY_URL, RELAY_API_KEY_KEY } from "../constants.js"

/**
 * Get relay API key from KV storage.
 *
 * Returns null if not configured.
 */
export async function getRelayApiKey(env: { CONFIG: KVNamespace }): Promise<string | null> {
  const stored = await env.CONFIG.get(RELAY_API_KEY_KEY)
  return stored || null
}

/**
 * Build the production RelayClient from env + the KV-stored API key.
 *
 * Single construction site for the UI worker (routes/relay.ts, routes/webhooks.ts,
 * jobs/webhook-registration-job.ts) — the specifier "@firela/billclaw-core/relay"
 * is what vi.mock intercepts in tests. Throws when no key is configured rather
 * than silently constructing a client whose every request would 401.
 */
export async function getRelayClient(
  env: { CONFIG: KVNamespace; FIRELA_RELAY_URL?: string },
): Promise<RelayClient> {
  const apiKey = await getRelayApiKey(env)
  if (!apiKey) {
    throw new Error("Relay API key not configured")
  }
  return new RelayClient({
    url: env.FIRELA_RELAY_URL || DEFAULT_RELAY_URL,
    apiKey,
  })
}
