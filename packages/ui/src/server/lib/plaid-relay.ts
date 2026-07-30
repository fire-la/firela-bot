/**
 * Shared Plaid relay client factory.
 *
 * Creates a RelayPlaidClient from environment bindings + the KV-stored relay API
 * key. Extracted from routes/oauth/plaid.ts so the OAuth routes and the scheduled
 * sync job share one construction path (Rule 0 — single source).
 *
 * @packageDocumentation
 */

import { RelayPlaidClient } from "@firela/billclaw-core"

import { DEFAULT_RELAY_URL } from "../constants.js"
import { getRelayApiKey } from "./relay-helpers.js"

/**
 * Minimal env shape required to build a Plaid relay client.
 *
 * Both the OAuth routes' `OAuthEnv` and the main server `Env` satisfy this.
 */
export interface PlaidRelayEnv {
  CONFIG: KVNamespace
  FIRELA_RELAY_URL?: string
}

/**
 * Create a RelayPlaidClient from environment bindings or the KV-stored key.
 *
 * Validates that a relay API key is available before creating the client.
 *
 * @throws Error if the relay API key is not configured.
 */
export async function getPlaidRelayClient(
  env: PlaidRelayEnv,
): Promise<RelayPlaidClient> {
  const apiKey = await getRelayApiKey(env)
  if (!apiKey) {
    throw new Error("Relay API key not configured. Set it in Settings.")
  }

  return new RelayPlaidClient(
    { relayUrl: env.FIRELA_RELAY_URL || DEFAULT_RELAY_URL, relayApiKey: apiKey },
    console,
  )
}
