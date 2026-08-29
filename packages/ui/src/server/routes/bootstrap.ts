/**
 * First-run bootstrap surface (ADR-009 Decision C, issue #21)
 *
 * Deploy Button deployments have no CLI output and (end state) no SPA — the
 * Worker itself is the only channel that can birth a pairing code. On a FRESH
 * deployment (no setup password, nothing ever redeemed), GET / renders a
 * one-time text/plain pairing page; otherwise it delegates to the app's
 * notFound (SPA fallback). Bootstrap-only: the surface disappears after the
 * first successful redeem or owner setup and never comes back.
 *
 * ONE mechanism with /api/pair/issue (Decision B): claims are minted with the
 * exact same KV shape + TTL, so the mobile app redeems via the unchanged
 * public POST /api/pair/redeem. The `origin: "bootstrap"` marker distinguishes
 * the mint source for audit / the future Claim Deployments reconciliation.
 *
 * Routing prerequisite: Workers Assets serves dist/index.html for "/" without
 * invoking Worker code, so wrangler.toml [assets] must list "/" in
 * `run_worker_first`. NOTE: with an array, NON-matching paths never reach the
 * Worker (assets-only, no Worker fallback) — the list must cover every public
 * mount ("/", "/health", "/api/*", "/auth/*", "/webhook/*").
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import type { Env } from "../index.js"
import {
  PAIR_BOOTSTRAP_CURRENT_KEY,
  PAIR_BOOTSTRAP_DONE_KEY,
  PAIR_CLAIM_PREFIX,
  PAIR_CLAIM_TTL_SEC,
  SETUP_PASSWORD_KEY,
} from "../constants.js"
import { generateClaimCode } from "../lib/pair-helpers.js"

export const bootstrapRoutes = new Hono<{ Bindings: Env }>()

function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Return the still-pending bootstrap claim, minting a new one only when the
 * current pointer is stale (claim used, expired, or pruned). Keeps KV writes
 * bounded (~1 mint per claim TTL per fresh deployment) and lets the user
 * refresh the page without invalidating the code they are typing.
 */
async function currentOrNewClaim(
  kv: KVNamespace,
): Promise<{ code: string; createdAt: number }> {
  const existing = await kv.get(PAIR_BOOTSTRAP_CURRENT_KEY)
  if (existing) {
    const claim = (await kv.get(PAIR_CLAIM_PREFIX + existing, "json")) as
      | { status?: string; createdAt?: number }
      | null
    if (
      claim?.status === "pending" &&
      typeof claim.createdAt === "number" &&
      claim.createdAt + PAIR_CLAIM_TTL_SEC > nowSec()
    ) {
      return { code: existing, createdAt: claim.createdAt }
    }
    // Pointer stale — fall through and mint a fresh code.
  }
  const code = generateClaimCode()
  const createdAt = nowSec()
  // Same claim shape as /api/pair/issue (plus the origin marker) so redeem
  // needs no changes. TTL re-passed on the pointer so it self-prunes with the
  // claim instead of outliving the deployment's fresh window.
  await kv.put(
    PAIR_CLAIM_PREFIX + code,
    JSON.stringify({ status: "pending", createdAt, origin: "bootstrap" }),
    { expirationTtl: PAIR_CLAIM_TTL_SEC },
  )
  await kv.put(PAIR_BOOTSTRAP_CURRENT_KEY, code, {
    expirationTtl: PAIR_CLAIM_TTL_SEC,
  })
  return { code, createdAt }
}

/**
 * GET / — fresh-deployment pairing page (text/plain), else SPA fallback.
 */
bootstrapRoutes.get("/", async (c) => {
  const kv = c.env.CONFIG
  // Fresh gate: owner setup OR any past redeem permanently closes the surface.
  if (await kv.get(SETUP_PASSWORD_KEY)) return c.notFound()
  if (await kv.get(PAIR_BOOTSTRAP_DONE_KEY)) return c.notFound()

  const { code, createdAt } = await currentOrNewClaim(kv)
  const origin = new URL(c.req.url).origin
  const minutesLeft = Math.max(
    1,
    Math.ceil((createdAt + PAIR_CLAIM_TTL_SEC - nowSec()) / 60),
  )
  // Display grouping mirrors src/lib/pairing.ts groupClaimCode — that module is
  // client-side (imports navigator.clipboard) and must not enter the server bundle.
  const grouped = `${code.slice(0, 4)}-${code.slice(4)}`
  const body = [
    "firela-bot is deployed and waiting to pair with the mobile app.",
    "",
    `Worker URL:  ${origin}`,
    `Claim code:  ${grouped}  (single-use, expires in ~${minutesLeft} min)`,
    "Pairing link (open in the firela app):",
    `${origin}/pair#code=${code}`,
    "",
    "This page disappears after the first successful pairing.",
    `To set the dashboard password instead, open ${origin}/auth/setup`,
  ].join("\n")

  // The body carries a live credential — never cache it.
  c.header("Cache-Control", "no-store")
  return c.text(body)
})
