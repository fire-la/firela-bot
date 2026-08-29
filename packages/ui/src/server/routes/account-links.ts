/**
 * External Account Link API Routes (issue #18 Tier 0, ADR-0113 P1)
 *
 * Open Banking connect flow: discover the user's Plaid accounts (credentials
 * stay in this Worker — provider calls go through the relay proxy), list the
 * user's vlt BeanAccounts, and write the opaque external-account → BeanAccount
 * links to vlt. vlt never sees account names/masks or credentials.
 *
 * Owner-only: deliberately NOT in APP_ROLE_ALLOWLIST, so the auth middleware
 * denies the app role. Links are written with the owner's VLT credential.
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import { VltClient, type VltRegion } from "@firela/billclaw-core"
// NOTE: the root `PlaidAccount` is the internal {id, plaidAccessToken} config
// type — the relay wire type (account_id/name/mask/balances) lives under /relay.
import type { PlaidAccount } from "@firela/billclaw-core/relay"

import type { Env } from "../index.js"
import { isPlaidItemDue, type PlaidItem } from "../lib/plaid-item.js"
import { getPlaidRelayClient } from "../lib/plaid-relay.js"
import { getVltJwt } from "../lib/vlt-auth.js"

export const accountLinksRoutes = new Hono<{ Bindings: Env }>()

// 500 up front when the CONFIG binding is absent (matches existing routes);
// one middleware instead of five per-handler copies.
accountLinksRoutes.use("*", async (c, next) => {
  if (!c.env.CONFIG) {
    return c.json(
      { success: false, error: "KV storage not configured", errorCode: "KV_NOT_CONFIGURED" },
      500,
    )
  }
  await next()
})

// KV keys (same as sync-job.ts)
const CONFIG_KEY = "billclaw:config"
const ACCOUNTS_KEY = "billclaw:accounts"

/** Tier 0 is plaid-only; the provider value sent to vlt is pinned server-side. */
const PROVIDER = "plaid"

interface StoredVltConfig {
  apiUrl: string
  accessToken?: string
  region?: VltRegion
}

/** One discovered external account row (display shape for the mapping UI). */
export interface DiscoveredAccount {
  provider: "plaid"
  externalAccountId: string
  /** billclaw-side provenance (which connected Plaid item this came from). */
  itemId: string
  itemName: string
  name: string
  mask?: string
  type: string
  subtype?: string
  currency?: string
  currentBalance?: number
  availableBalance?: number
}

export interface ItemDiscoveryError {
  itemId: string
  itemName?: string
  error: string
}

const createLinkSchema = z.object({
  externalAccountId: z.string().min(1, "externalAccountId is required"),
  beanAccountId: z.string().min(1, "beanAccountId is required"),
})

const idParamSchema = z.object({
  id: z.string().min(1, "id is required"),
})

/**
 * Read the VLT connection from KV; null when VLT is not configured.
 */
async function resolveVlt(env: Env): Promise<StoredVltConfig | null> {
  const config = await env.CONFIG.get<{ vlt?: StoredVltConfig }>(CONFIG_KEY, "json")
  const vlt = config?.vlt
  if (!vlt?.accessToken) return null
  return vlt
}

/**
 * Build a VltClient with a cached JWT. Returns null when VLT is not configured.
 */
async function getVltClient(env: Env): Promise<VltClient | null> {
  const vlt = await resolveVlt(env)
  if (!vlt) return null
  const region = (vlt.region ?? "us") as VltRegion
  const jwt = await getVltJwt(env, {
    apiUrl: vlt.apiUrl,
    accessToken: vlt.accessToken,
    region,
  })
  return new VltClient({ apiUrl: vlt.apiUrl, apiToken: jwt, region })
}

/**
 * Map a relay Plaid account to the discovery row shape.
 *
 * `name` is typed required by the relay schema but not runtime-validated —
 * coerce with the mask fallback.
 */
function toDiscovered(item: PlaidItem, a: PlaidAccount): DiscoveredAccount {
  return {
    provider: "plaid",
    externalAccountId: a.account_id,
    itemId: item.id,
    itemName: item.name ?? item.id,
    name: a.name || (a.mask ? `Plaid ••${a.mask}` : "Unnamed account"),
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    currency: a.balances?.iso_currency_code,
    currentBalance: a.balances?.current,
    availableBalance: a.balances?.available,
  }
}

/**
 * GET /api/account-links/discover
 *
 * Discover external accounts for all connected Plaid items via the relay
 * proxy. Per-item failures are reported in `errors`, not fatal.
 */
accountLinksRoutes.get("/discover", async (c) => {
  try {
    const accounts =
      (await c.env.CONFIG.get<PlaidItem[]>(ACCOUNTS_KEY, "json")) ?? []
    // Same due-filter as the sync job (lib/plaid-item.ts): only items the
    // sync will actually feed are mappable — otherwise links would be dead.
    const due = accounts.filter(isPlaidItemDue)

    // Short-circuit before touching the relay: on a fresh deployment (no
    // Plaid accounts, possibly no relay key) the empty state must render.
    if (due.length === 0) {
      return c.json({ success: true, data: { accounts: [], errors: [] } })
    }

    const client = await getPlaidRelayClient(c.env)

    const results = await Promise.all(
      due.map(async (item) => {
        try {
          const res = await client.getAccounts(item.plaidAccessToken!)
          return {
            rows: (res.accounts ?? []).map((a) => toDiscovered(item, a)),
            error: null as ItemDiscoveryError | null,
          }
        } catch (err) {
          return {
            rows: [] as DiscoveredAccount[],
            error: {
              itemId: item.id,
              itemName: item.name ?? item.id,
              error: err instanceof Error ? err.message : String(err),
            },
          }
        }
      }),
    )

    return c.json({
      success: true,
      data: {
        accounts: results.flatMap((r) => r.rows),
        errors: results.flatMap((r) => (r.error ? [r.error] : [])),
      },
    })
  } catch (error) {
    console.error("[account_links] discover failed:", error)
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Discovery failed",
        errorCode: "RELAY_ERROR",
      },
      502,
    )
  }
})

/**
 * GET /api/account-links/bean-accounts
 *
 * List the user's BeanAccounts from vlt (mapping targets).
 */
accountLinksRoutes.get("/bean-accounts", async (c) => {
  try {
    const client = await getVltClient(c.env)
    if (!client) {
      return c.json(
        { success: false, error: "VLT is not configured", errorCode: "VLT_NOT_CONFIGURED" },
        400,
      )
    }
    const items = await client.listBeanAccounts()
    return c.json({ success: true, data: { accounts: items } })
  } catch (error) {
    console.error("[account_links] list bean accounts failed:", error)
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list BeanAccounts",
        errorCode: "VLT_UPSTREAM_ERROR",
      },
      502,
    )
  }
})

/**
 * GET /api/account-links
 *
 * List the user's active external account links from vlt.
 */
accountLinksRoutes.get("/", async (c) => {
  try {
    const client = await getVltClient(c.env)
    if (!client) {
      return c.json(
        { success: false, error: "VLT is not configured", errorCode: "VLT_NOT_CONFIGURED" },
        400,
      )
    }
    const result = await client.listExternalAccountLinks(PROVIDER)
    return c.json({ success: true, data: result })
  } catch (error) {
    console.error("[account_links] list links failed:", error)
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list links",
        errorCode: "VLT_UPSTREAM_ERROR",
      },
      502,
    )
  }
})

/**
 * POST /api/account-links
 *
 * Create an external account → BeanAccount link in vlt. Provider is pinned
 * server-side ("plaid", Tier 0) — clients only send the two opaque ids.
 */
accountLinksRoutes.post(
  "/",
  zValidator("json", createLinkSchema),
  async (c) => {
    try {
      const client = await getVltClient(c.env)
      if (!client) {
        return c.json(
          { success: false, error: "VLT is not configured", errorCode: "VLT_NOT_CONFIGURED" },
          400,
        )
      }
      const { externalAccountId, beanAccountId } = c.req.valid("json")
      const link = await client.createExternalAccountLink({
        provider: PROVIDER,
        externalAccountId,
        beanAccountId,
      })
      return c.json({ success: true, data: link })
    } catch (error) {
      console.error("[account_links] create link failed:", error)
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create link",
          errorCode: "VLT_UPSTREAM_ERROR",
        },
        502,
      )
    }
  },
)

/**
 * DELETE /api/account-links/:id
 *
 * Soft-delete a link in vlt (isActive=false; history preserved). Remapping is
 * DELETE then POST (vlt semantics).
 */
accountLinksRoutes.delete(
  "/:id",
  zValidator("param", idParamSchema),
  async (c) => {
    try {
      const client = await getVltClient(c.env)
      if (!client) {
        return c.json(
          { success: false, error: "VLT is not configured", errorCode: "VLT_NOT_CONFIGURED" },
          400,
        )
      }
      await client.deleteExternalAccountLink(c.req.valid("param").id)
      return c.json({ success: true })
    } catch (error) {
      console.error("[account_links] delete link failed:", error)
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to delete link",
          errorCode: "VLT_UPSTREAM_ERROR",
        },
        502,
      )
    }
  },
)
