/**
 * First-run bootstrap surface (ADR-009 Decision C, issue #21)
 *
 * Deploy Button deployments have no CLI output and (end state) no SPA — the
 * Worker itself is the only channel that can birth a pairing code. On a FRESH
 * deployment (no setup password, nothing ever redeemed), GET / renders a
 * one-time minimal static HTML pairing page (tappable link + inline SVG QR,
 * issue #25); otherwise it delegates to the app's notFound (SPA fallback).
 * Bootstrap-only: the surface disappears after the first successful redeem or
 * owner setup and never comes back.
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
import { renderSVG } from "uqr"
import type { Env } from "../index.js"
import {
  PAIR_BOOTSTRAP_CURRENT_KEY,
  PAIR_BOOTSTRAP_DONE_KEY,
  PAIR_CLAIM_PREFIX,
  PAIR_CLAIM_TTL_SEC,
  SETUP_PASSWORD_KEY,
} from "../constants.js"
import { mintPendingClaim, nowSec } from "../lib/pair-helpers.js"

export const bootstrapRoutes = new Hono<{ Bindings: Env }>()

/**
 * Return the still-pending bootstrap claim, minting a new one only when the
 * current pointer is stale (claim used, expired, or pruned). Keeps KV writes
 * bounded (~1 mint per claim TTL per fresh deployment) and lets the user
 * refresh the page without invalidating the code they are typing.
 *
 * NOTE: read-then-write race — concurrent first requests can mint multiple
 * pending claims. Accepted as the same class as the no-CAS redeem race
 * (ADR-009 D2): every code is single-use, 600s-TTL, and GET / is public
 * anyway (anyone can mint one for themselves), so the race grants no
 * capability beyond the documented first-caller model.
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
  // Shared mint path with /api/pair/issue (lib/pair-helpers.ts); the
  // `origin` marker distinguishes the bootstrap source. Pointer TTL matches
  // the claim TTL so it self-prunes with it.
  const { code, createdAt } = await mintPendingClaim(kv, { origin: "bootstrap" })
  await kv.put(PAIR_BOOTSTRAP_CURRENT_KEY, code, {
    expirationTtl: PAIR_CLAIM_TTL_SEC,
  })
  return { code, createdAt }
}

/**
 * GET / — fresh-deployment pairing page (minimal static HTML), else SPA
 * fallback (issue #25: text/plain URLs are not tappable on mobile — a real
 * `<a>` makes long-press → "Copy link address" the handoff, and the inline QR
 * serves the screenshot-scan and desktop-browser paths).
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
  const pairingUrl = `${origin}/pair#code=${code}`
  // Same QR contract as the SPA Pair page (qrcode.react level "M", 4-module
  // quiet zone). renderSVG emits viewBox-only SVG — no fixed size, no scripts.
  const qr = renderSVG(pairingUrl, { ecc: "M", border: 4 })

  // Single static response: inline styles, no scripts, no external resources
  // (no CDN, no webfonts). No HTML escaping needed today: `origin` comes from
  // URL parsing (forbidden host code points cover < > ") and the code is
  // Crockford-alphabet only — asserted to avoid drift with pair-helpers.ts.
  if (!/^[0-9A-Z]{8}$/.test(code)) throw new Error("unexpected claim-code shape")
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>firela-bot — pair your app</title>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; color: #111;
         background: #f6f6f7; }
  main { max-width: 30rem; margin: 0 auto; padding: 2rem 1.25rem; }
  .card { background: #fff; border-radius: 0.75rem; padding: 1.5rem;
          display: flex; flex-direction: column; align-items: center;
          gap: 1rem; }
  .qr { display: inline-flex; background: #fff; }
  .qr svg { width: min(70vw, 16rem); height: auto; }
  #claim { font-family: ui-monospace, monospace; font-size: 2rem;
           font-weight: 700; letter-spacing: 0.2em;
           -webkit-user-select: all; user-select: all; }
  a { word-break: break-all; }
  small { color: #555; }
</style>
</head>
<body>
<main>
  <h1>firela-bot is deployed</h1>
  <p>Scan this QR in the firela app, or use the pairing link below.
     This page disappears after the first successful pairing.</p>
  <div class="card">
    <div class="qr">${qr}</div>
    <div><code id="claim">${grouped}</code></div>
    <p><a href="${pairingUrl}">${pairingUrl}</a><br>
       <small>single-use, expires in ~${minutesLeft} min</small></p>
  </div>
  <p><small>Worker URL: ${origin}</small></p>
  <p><small>To set the dashboard password instead, open
     <a href="/auth/setup">${origin}/auth/setup</a></small></p>
</main>
</body>
</html>`

  // The body carries a live credential — never cache it.
  c.header("Cache-Control", "no-store")
  return c.html(body)
})
