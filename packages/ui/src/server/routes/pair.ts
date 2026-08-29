/**
 * Pairing API Routes (Plex-style claim pairing — ADR-009 PR-3)
 *
 * Lets the firela-app mobile client obtain a long-lived app JWT (`role: "app"`)
 * without the setup password. Reuses the ADR-008 HS256 + KV auth infra.
 *
 *   POST /api/pair/issue    (owner)   mint a single-use 8-char claim code (10m TTL)
 *   POST /api/pair/redeem   (public)  validate the claim, sign an app JWT, store
 *                                     the pairing/revocation record
 *   POST /api/pair/revoke   (owner)   mark a paired app revoked
 *   GET  /api/pair/apps     (owner)   list paired devices, newest-first
 *
 * `/redeem` is public (the claim code IS the auth); `/issue` + `/revoke` are
 * owner-only — enforced centrally by `authMiddleware`'s app-role default-deny
 * (neither is in `APP_ROLE_ALLOWLIST`).
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import type { Env } from "../index.js"
import {
  PAIR_APP_PREFIX,
  PAIR_APP_TTL_SEC,
  PAIR_BOOTSTRAP_DONE_KEY,
  PAIR_CLAIM_PREFIX,
  PAIR_CLAIM_TTL_SEC,
} from "../constants.js"
import {
  mintPendingClaim,
  normalizeClaimCode,
  nowSec,
  signAppToken,
} from "../lib/pair-helpers.js"

export const pairRoutes = new Hono<{ Bindings: Env }>()

const redeemSchema = z.object({
  claimCode: z.string().min(1, "claimCode is required"),
})

const revokeSchema = z.object({
  appId: z.string().min(1, "appId is required"),
})

/**
 * POST /api/pair/issue (owner)
 *
 * Mint a single-use claim code. Owner-only (not app-allowlisted).
 */
pairRoutes.post("/issue", async (c) => {
  const { code, createdAt } = await mintPendingClaim(c.env.CONFIG)
  return c.json({
    success: true,
    claimCode: code,
    workerUrl: new URL(c.req.url).origin,
    expiresAt: createdAt + PAIR_CLAIM_TTL_SEC,
  })
})

/**
 * POST /api/pair/redeem (public — claim code is the auth)
 *
 * Validate the claim, mark it used (TTL re-applied so it does not become a
 * permanent KV entry), sign an app JWT, and write the pairing/revocation record
 * with its D2 TTL-on-entry.
 */
pairRoutes.post("/redeem", zValidator("json", redeemSchema), async (c) => {
  const { claimCode: rawCode } = c.req.valid("json")
  const code = normalizeClaimCode(rawCode)
  const claimKey = PAIR_CLAIM_PREFIX + code

  const claim = (await c.env.CONFIG.get(claimKey, "json")) as
    | { status?: string }
    | null
  if (!claim) {
    return c.json(
      {
        success: false,
        error: "Claim code not found or expired",
        errorCode: "CLAIM_NOT_FOUND",
      },
      404,
    )
  }
  if (claim.status !== "pending") {
    return c.json(
      {
        success: false,
        error: "Claim code already used",
        errorCode: "CLAIM_ALREADY_USED",
      },
      409,
    )
  }

  // Server-generated appId: the caller must NOT name the revocation-record key.
  // This is a public endpoint — a client-chosen appId could collide with an
  // existing paired device and overwrite it (e.g. silently un-revoke). The id is
  // returned so the app / a future owner list endpoint can reference it.
  const appId = crypto.randomUUID()

  // Mark used — MUST re-pass expirationTtl: a KV put without it makes the key
  // permanent, leaking every claim ever issued (kept short per the single-use design).
  await c.env.CONFIG.put(
    claimKey,
    JSON.stringify({ status: "used", appId }),
    { expirationTtl: PAIR_CLAIM_TTL_SEC },
  )

  const pairingToken = await signAppToken(c.env, appId)
  await c.env.CONFIG.put(
    PAIR_APP_PREFIX + appId,
    JSON.stringify({ appId, pairedAt: nowSec(), revoked: false }),
    { expirationTtl: PAIR_APP_TTL_SEC },
  )

  // Close the first-run bootstrap surface (issue #21): GET / stops rendering
  // the one-time pairing page after any successful redeem. Last write before
  // the return so the surface only closes on a fully successful redeem.
  // Unconditional and permanent (no TTL — a deployment-lifetime flag, unlike
  // the claims above). Accepted: KV eventual consistency can leave GET /
  // rendering for ~60s (same class as the no-CAS redeem race, ADR-009 D2).
  await c.env.CONFIG.put(
    PAIR_BOOTSTRAP_DONE_KEY,
    JSON.stringify({ appId, completedAt: nowSec() }),
  )

  return c.json({
    success: true,
    pairingToken,
    appId,
    workerUrl: new URL(c.req.url).origin,
  })
})

/**
 * POST /api/pair/revoke (owner)
 *
 * Mark a paired app revoked. Re-puts with the same TTL so the record still
 * self-prunes ~max-token-age later (a bare put would make it permanent).
 */
pairRoutes.post("/revoke", zValidator("json", revokeSchema), async (c) => {
  const { appId } = c.req.valid("json")
  const key = PAIR_APP_PREFIX + appId

  const rec = (await c.env.CONFIG.get(key, "json")) as
    | { appId?: string; pairedAt?: number; revoked?: boolean }
    | null
  if (!rec) {
    return c.json(
      { success: false, error: "App is not paired", errorCode: "APP_NOT_PAIRED" },
      404,
    )
  }

  await c.env.CONFIG.put(
    key,
    JSON.stringify({ ...rec, appId, revoked: true }),
    { expirationTtl: PAIR_APP_TTL_SEC },
  )

  return c.json({ success: true })
})

/**
 * GET /api/pair/apps (owner)
 *
 * List paired devices (KV prefix PAIR_APP_PREFIX), newest-first. KV list is
 * paginated (max 1000 keys/page) — loop the cursor. Records failing the
 * shape check are skipped, not fatal.
 */
pairRoutes.get("/apps", async (c) => {
  const apps: { appId: string; pairedAt: number; revoked: boolean }[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await c.env.CONFIG.list({ prefix: PAIR_APP_PREFIX, cursor })
    for (const { name } of page.keys) {
      const rec = (await c.env.CONFIG.get(name, "json")) as
        | { appId?: unknown; pairedAt?: unknown; revoked?: unknown }
        | null
      if (
        rec &&
        typeof rec.appId === "string" &&
        typeof rec.pairedAt === "number"
      ) {
        apps.push({
          appId: rec.appId,
          pairedAt: rec.pairedAt,
          revoked: rec.revoked === true,
        })
      }
    }
    // `=== false` (not truthiness): this package compiles with
    // strictNullChecks off, where truthiness cannot narrow the
    // list_complete discriminant and page.cursor would not typecheck.
    if (page.list_complete === false) cursor = page.cursor
    else break
  }
  apps.sort((a, b) => b.pairedAt - a.pairedAt)
  return c.json({ success: true, apps })
})

export default pairRoutes
