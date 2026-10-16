/**
 * Scheduled relay webhook-callback registration job (issue #33).
 *
 * Re-arms the relay-side 24h callback registration (POST /api/open-banking/health,
 * routing key derived server-side from the relay token). Runs on every cron
 * tick (6h) — idempotent and cheap, 4 refreshes per 24h TTL window; if this
 * job fails long-term, webhook delivery dies 24h after the last success
 * (observable via the firela:relay:webhook_registered_at stamp).
 *
 * Skips silently when the relay key or the captured deployment origin is
 * absent (origin is captured from request traffic by lib/deployment-origin.ts
 * — a deployment nobody has visited has nothing to register).
 *
 * @packageDocumentation
 */

import type { Env } from "../index.js"
import { DEPLOYMENT_ORIGIN_KEY, WEBHOOK_REGISTERED_AT_KEY } from "../constants.js"
import { getRelayApiKey, getRelayClient } from "../lib/relay-helpers.js"
import { RelayError } from "@firela/billclaw-core/relay"

export async function runWebhookRegistrationJob(env: Env): Promise<void> {
  try {
    if (!(await getRelayApiKey(env))) return
    const origin = await env.CONFIG.get(DEPLOYMENT_ORIGIN_KEY)
    if (!origin) return

    const client = await getRelayClient(env)
    const result = await client.registerWebhookCallback(`${origin}/webhook/plaid`)

    await env.CONFIG.put(WEBHOOK_REGISTERED_AT_KEY, new Date().toISOString())
    console.log("[webhook-registration] registered callback:", {
      callbackUrl: `${origin}/webhook/plaid`,
      accountId: result.account_id,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // parseRelayError maps the 403 to RelayError RELAY_FORBIDDEN — the one
    // failure an owner can actually fix (rotate the key with openbanking
    // scope). Match the stable error identity, not message substrings.
    if (error instanceof RelayError && error.code === "RELAY_FORBIDDEN") {
      console.error(
        "[webhook-registration] relay API key lacks openbanking scope — regenerate the key with openbanking scope and update Settings → Relay:",
        message,
      )
    } else {
      console.error("[webhook-registration] failed:", message)
    }
  }
}
