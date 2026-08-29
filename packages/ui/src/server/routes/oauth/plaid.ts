/**
 * Plaid OAuth routes (Hono)
 *
 * Provides HTTP endpoints for Plaid Link OAuth flow via firela-relay.
 * All Plaid API calls are proxied through RelayPlaidClient, keeping
 * the relay API key server-side (stored in KV).
 *
 * Migrated from Express (packages/connect/src/routes/plaid.ts) to Hono,
 * then updated from Direct mode to Relay mode.
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"

import { getPlaidRelayClient } from "../../lib/plaid-relay.js"
import type { OAuthEnv as Env } from "./env.js"

// KV key for accounts storage (same as accounts.ts)
const ACCOUNTS_KEY = "billclaw:accounts"

export const plaidRoutes = new Hono<{ Bindings: Env }>()

/**
 * Request validation schemas
 */
const exchangeTokenSchema = z.object({
  publicToken: z.string().min(1, "publicToken is required"),
  accountId: z.string().optional(),
  sessionId: z.string().optional(),
})

// Allowlisted country codes (Plaid API country_codes enum, fail-closed)
const SUPPORTED_COUNTRY_CODES = [
  "US",
  "CA",
  "GB",
  "FR",
  "DE",
  "ES",
  "IE",
  "NL",
  "IT",
  "PL",
  "DK",
  "NO",
  "SE",
  "EE",
  "LT",
  "LV",
  "PT",
] as const
const SUPPORTED_PRODUCTS = ["transactions"] as const

// "us, CA" -> ["US","CA"] / "transactions" -> ["transactions"]:
// trim + dedupe, drop empty segments. Country codes uppercase (ISO 3166-1
// alpha-2); product names stay lowercase (Plaid API identifiers).
const parseCountryCsv = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  ),
]
const parseProductCsv = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
]

const linkTokenQuerySchema = z.object({
  country_codes: z
    .string()
    .optional()
    .transform((v) => parseCountryCsv(v ?? "US"))
    .pipe(z.array(z.enum(SUPPORTED_COUNTRY_CODES)).min(1)),
  products: z
    .string()
    .optional()
    .transform((v) => parseProductCsv(v ?? "transactions"))
    .pipe(z.array(z.enum(SUPPORTED_PRODUCTS)).min(1)),
})

/**
 * GET /api/oauth/plaid/link-token
 *
 * Create a Plaid Link token for initializing the Plaid Link frontend.
 * Proxied through firela-relay.
 *
 * Query params (optional, allowlisted — invalid values fail with 400
 * before reaching the relay):
 * - country_codes: comma-separated Plaid country codes (default: US)
 * - products: comma-separated Plaid products (default: transactions)
 *
 * Response:
 * - success: boolean
 * - linkToken: string - Link token for Plaid Link initialization
 */
plaidRoutes.get(
  "/link-token",
  zValidator("query", linkTokenQuerySchema),
  async (c) => {
    try {
      const { country_codes, products } = c.req.valid("query")
      const client = await getPlaidRelayClient(c.env)
      const result = await client.createLinkToken({
        client_name: "BillClaw",
        language: "en",
        country_codes,
        user: { client_user_id: `user_${Date.now()}` },
        products,
      })

      return c.json({
        success: true,
        linkToken: result.link_token,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create link token"
      console.error("[plaid_link_token]", error)

      return c.json(
        {
          success: false,
          error: message,
        },
        500,
      )
    }
  },
)

/**
 * POST /api/oauth/plaid/exchange
 *
 * Exchange a Plaid public token for an access token via relay.
 * Stores the account in KV for persistence.
 *
 * Request body:
 * - publicToken: Plaid public token (required)
 * - accountId: Account identifier (optional)
 * - sessionId: Session ID for credential polling (optional, for Direct mode)
 *
 * Response:
 * - success: boolean
 * - itemId: string - Plaid item ID
 *
 * The Plaid access token is persisted to KV (billclaw:accounts) for the
 * scheduled sync job and is NOT returned to the client.
 */
plaidRoutes.post(
  "/exchange",
  zValidator("json", exchangeTokenSchema),
  async (c) => {
    try {
      const { publicToken, sessionId } = c.req.valid("json")

      const client = await getPlaidRelayClient(c.env)
      const result = await client.exchangePublicToken(publicToken)

      // Store credential for Direct mode polling if sessionId is provided
      if (sessionId) {
        console.log("[plaid_exchange] Session ID provided but relay mode does not use credential store:", sessionId)
      }

      // Persist the account (incl. access token) so the scheduled sync job can
      // read it. If KV is unavailable or the write fails, fail the request: the
      // sync job cannot function without the persisted token, so returning
      // success would silently break auto-sync.
      if (!c.env.CONFIG) {
        return c.json(
          {
            success: false,
            error: "KV storage not configured; account could not be persisted",
          },
          500,
        )
      }

      try {
        const existingAccounts = await c.env.CONFIG.get(ACCOUNTS_KEY, "json")
        const accounts = Array.isArray(existingAccounts) ? existingAccounts : []

        // Create new account entry (persist the access token for the sync job)
        const newAccount = {
          id: result.item_id,
          name: `Plaid Account (${result.item_id.slice(0, 8)})`,
          provider: "plaid",
          type: "plaid",
          status: "connected",
          plaidAccessToken: result.access_token,
          lastSync: new Date().toISOString(),
        }

        // Check if account exists and update, or add new
        const existingIndex = accounts.findIndex((a) => a.id === result.item_id)
        if (existingIndex >= 0) {
          accounts[existingIndex] = { ...accounts[existingIndex], ...newAccount }
        } else {
          accounts.push(newAccount)
        }

        // Save back to KV
        await c.env.CONFIG.put(ACCOUNTS_KEY, JSON.stringify(accounts))
        console.log("[plaid_exchange] Account saved to KV:", result.item_id)
      } catch (kvError) {
        console.error("[plaid_exchange] Failed to save account to KV:", kvError)
        return c.json(
          { success: false, error: "Failed to persist account" },
          500,
        )
      }

      return c.json({
        success: true,
        itemId: result.item_id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Token exchange failed"
      console.error("[plaid_token_exchange]", error)

      return c.json(
        {
          success: false,
          error: message,
        },
        500,
      )
    }
  },
)

export default plaidRoutes
