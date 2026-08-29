/**
 * Pairing API Routes (Plex-style claim pairing — ADR-009 PR-3)
 *
 * Lets the firela-app mobile client obtain a long-lived app JWT (`role: "app"`)
 * without the setup password. Reuses the ADR-008 HS256 + KV auth infra.
 *
 *   POST /api/pair/issue           (owner; app with owner-password proof)
 *                                  mint a single-use 8-char claim code (10m TTL)
 *   POST /api/pair/redeem          (public)  validate the claim, sign an app JWT,
 *                                            store the pairing/revocation record
 *   POST /api/pair/establish-owner (app)     ownerless start (issue #26): create
 *                                            the owner password + first claim
 *   POST /api/pair/revoke          (owner; app with proof + guards)
 *   GET  /api/pair/apps            (owner)   list paired devices, newest-first
 *   POST /api/pair/apps            (app with owner-password proof) same list
 *   GET  /api/pair/config          (public)  Turnstile discovery for the redeem client
 *
 * `/redeem` is public (the claim code IS the auth). `/issue`, `/revoke`, and
 * `POST /apps` are app-reachable only with the owner password in the body
 * (proof-per-request — Track C, issue #26: the no-SPA CF cohort has no other
 * mint/revocation surface, and the app never receives an owner credential).
 * `GET /apps` and the owner paths stay owner-only.
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
  PAIR_CLAIM_TTL_SEC,
  SETUP_PASSWORD_KEY,
} from "../constants.js"
import {
  ensurePairClaimTable,
  getOwnerProofFailure,
  hasOtherLivePairedApp,
  mintPendingClaim,
  normalizeClaimCode,
  nowSec,
  proofLockRemaining,
  signAppToken,
  verifyTurnstileToken,
  type OwnerProofFailure,
} from "../lib/pair-helpers.js"
import { getUserId, isApp } from "../middleware/auth.js"

export const pairRoutes = new Hono<{ Bindings: Env }>()

const redeemSchema = z.object({
  claimCode: z.string().min(1, "claimCode is required"),
  // Present only when Turnstile enforcement is on (issue #23) — absence is
  // rejected in the handler, not by zod, because enforcement depends on env.
  turnstileToken: z.string().optional(),
})

const revokeSchema = z.object({
  appId: z.string().min(1, "appId is required"),
  // App-role proof only (#26 fast-follow); owners omit it.
  password: z.string().optional(),
})

const establishOwnerSchema = z.object({
  password: z.string().min(1, "Password is required"),
})

/** Map a failed owner-password proof onto its JSON error response. */
function proofErrorResponse(
  c: { json: (body: unknown, status: number) => Response },
  failure: OwnerProofFailure,
): Response {
  const body: Record<string, unknown> = {
    success: false,
    error: failure.error,
    errorCode: failure.errorCode,
  }
  if (failure.retryAfter != null) body.retryAfter = failure.retryAfter
  return c.json(body, failure.status)
}

/**
 * POST /api/pair/issue (owner; app with owner-password proof)
 *
 * Mint a single-use claim code. The owner path is unchanged (empty body).
 *
 * App-role branch (issue #26 / Track C): the no-SPA CF cohort's only mint
 * surface. The caller must carry the owner password in the body —
 * proof-per-request, so the app never receives an owner credential. The
 * `isApp()` check deliberately precedes body parsing: the owner path has
 * always sent an empty body and must not start 400ing.
 */
pairRoutes.post("/issue", async (c) => {
  if (isApp(c)) {
    const body = (await c.req.json().catch(() => null)) as {
      password?: unknown
    } | null
    const failure = await getOwnerProofFailure(
      c.env,
      getUserId(c)!,
      body?.password,
    )
    if (failure) return proofErrorResponse(c, failure)
    const { code, createdAt } = await mintPendingClaim(c.env.DB, {
      origin: "app",
    })
    return c.json({
      success: true,
      claimCode: code,
      workerUrl: new URL(c.req.url).origin,
      expiresAt: createdAt + PAIR_CLAIM_TTL_SEC,
    })
  }
  const { code, createdAt } = await mintPendingClaim(c.env.DB)
  return c.json({
    success: true,
    claimCode: code,
    workerUrl: new URL(c.req.url).origin,
    expiresAt: createdAt + PAIR_CLAIM_TTL_SEC,
  })
})

/**
 * POST /api/pair/establish-owner (app only)
 *
 * The CF-cohort funnel (deploy -> bootstrap redeem) never sets an owner
 * password. This is the ownerless start of Track C: the paired app creates
 * the password, and the first claim code rides the same response (M1b) — the
 * user just chose the password, re-typing it 30s later buys nothing. Never
 * returns a token: the app keeps its app-role JWT and proves per request.
 *
 * Concurrent first-writes are last-write-wins; the loser of the race gets
 * 409 OWNER_ALREADY_ESTABLISHED (both callers hold valid paired-app JWTs, so
 * the race is benign — recorded in ADR-009).
 */
pairRoutes.post(
  "/establish-owner",
  zValidator("json", establishOwnerSchema),
  async (c) => {
    if (!isApp(c)) {
      return c.json(
        {
          success: false,
          error: "Only a paired app can establish the owner password",
          errorCode: "AUTH_INVALID_ROLE",
        },
        403,
      )
    }
    const appId = getUserId(c)!
    // No password comparison happens here, so there is nothing to guess — but
    // the shared per-appId lock still applies (a caller that burned the lock
    // guessing on /issue does not get a side door).
    const lockRemaining = await proofLockRemaining(c.env.DB, appId)
    if (lockRemaining > 0) {
      return proofErrorResponse(c, {
        status: 429,
        error: "Too many failed owner-password attempts; try again later",
        errorCode: "PROOF_THROTTLED",
        retryAfter: lockRemaining,
      })
    }
    const stored = (await c.env.CONFIG.get(SETUP_PASSWORD_KEY)) as string | null
    if (stored) {
      return c.json(
        {
          success: false,
          error: "Owner password already established",
          errorCode: "OWNER_ALREADY_ESTABLISHED",
        },
        409,
      )
    }
    const { password } = c.req.valid("json")
    await c.env.CONFIG.put(SETUP_PASSWORD_KEY, password)
    const { code, createdAt } = await mintPendingClaim(c.env.DB, {
      origin: "app",
    })
    return c.json({
      success: true,
      claimCode: code,
      workerUrl: new URL(c.req.url).origin,
      expiresAt: createdAt + PAIR_CLAIM_TTL_SEC,
    })
  },
)

/**
 * POST /api/pair/redeem (public — claim code is the auth)
 *
 * Atomically flip the claim pending -> used with one conditional D1 UPDATE
 * (issue #24: KV has no compare-and-swap, so a get-check-put sequence let two
 * concurrent redeems of one code both mint a 1y app JWT; `meta.changes === 1`
 * is the single-use gate — the loser of the flip gets 409). Expiry is the
 * `created_at` cutoff baked into the WHERE clause (D1 has no TTL-on-entry;
 * expired rows are pruned lazily on mint). On success, sign an app JWT and
 * write the pairing/revocation record in KV with its D2 TTL-on-entry.
 *
 * The Turnstile gate (#23) runs BEFORE any D1 touch, so brute-force attempts
 * never reach the claim store.
 */
pairRoutes.post("/redeem", zValidator("json", redeemSchema), async (c) => {
  const { claimCode: rawCode, turnstileToken } = c.req.valid("json")

  // Turnstile gate (#23): enforcement on only when BOTH keys are configured —
  // zero-config deploys keep the bare claim-code flow, and one key alone is a
  // misconfiguration treated as OFF (otherwise the app could fetch a
  // `turnstileEnabled` config with no sitekey to render the widget from).
  if (c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY) {
    if (!turnstileToken) {
      return c.json(
        {
          success: false,
          error: "Turnstile verification required",
          errorCode: "TURNSTILE_REQUIRED",
        },
        400,
      )
    }
    const verdict = await verifyTurnstileToken(
      c.env.TURNSTILE_SECRET_KEY,
      turnstileToken,
    )
    if (verdict === "unavailable") {
      // Fail-closed: fail-open would disable the control precisely under the
      // automated-guessing load it exists for. siteverify runs on CF's own
      // edge — if it is down, pairing can wait a minute.
      return c.json(
        {
          success: false,
          error: "Turnstile verification unavailable",
          errorCode: "TURNSTILE_UNAVAILABLE",
        },
        503,
      )
    }
    if (verdict === "invalid") {
      return c.json(
        {
          success: false,
          error: "Turnstile verification failed",
          errorCode: "TURNSTILE_INVALID",
        },
        403,
      )
    }
  }

  const code = normalizeClaimCode(rawCode)
  await ensurePairClaimTable(c.env.DB)

  // Server-generated appId: the caller must NOT name the revocation-record key.
  // This is a public endpoint — a client-chosen appId could collide with an
  // existing paired device and overwrite it (e.g. silently un-revoke). The id is
  // returned so the app / a future owner list endpoint can reference it.
  // Generated up-front: the flip statement needs it, and the loser's id is
  // simply discarded.
  const appId = crypto.randomUUID()
  const now = nowSec()

  // The single-use gate: D1 serializes this one statement, so exactly one
  // concurrent redeemer can match `status = 'pending'`.
  const flipped = await c.env.DB.prepare(
    `UPDATE pair_claim SET status = ?1, app_id = ?2, redeemed_at = ?3
      WHERE code = ?4 AND status = 'pending' AND created_at > ?5`,
  )
    .bind("used", appId, now, code, now - PAIR_CLAIM_TTL_SEC)
    .run()

  if (flipped.meta.changes !== 1) {
    // Disambiguate the loss: used vs not-found/expired.
    const row = await c.env.DB.prepare(
      "SELECT status FROM pair_claim WHERE code = ?1",
    )
      .bind(code)
      .first<{ status: string } | null>()
    if (row?.status === "used") {
      return c.json(
        {
          success: false,
          error: "Claim code already used",
          errorCode: "CLAIM_ALREADY_USED",
        },
        409,
      )
    }
    return c.json(
      {
        success: false,
        error: "Claim code not found or expired",
        errorCode: "CLAIM_NOT_FOUND",
      },
      404,
    )
  }

  // Burned-claim note: a crash between this flip and the response burns the
  // code without delivering the token (same window the KV flow had — the
  // flip always preceded the response). Recovery is user-side and simple:
  // mint a new code (/api/pair/issue, or refresh the still-open bootstrap
  // page). Deliberately NO retry path that treats a used row as redeemable
  // again — that would reopen the exact race the atomic flip closes.

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
  // rendering for ~60s (ADR-009 Decision C residual — the redeem race itself
  // is closed by the atomic D1 flip above).
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
 * GET /api/pair/config (public — PUBLIC_PATHS)
 *
 * Pre-redeem discovery for the native client (issue #23): whether Turnstile is
 * enforced on /redeem and the sitekey needed to render the widget. Exposes
 * nothing secret — the sitekey is public by design (it ships in the widget
 * HTML); the secret key never leaves the Worker.
 */
pairRoutes.get("/config", (c) => {
  const enabled = Boolean(c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY)
  return c.json({
    success: true,
    turnstileEnabled: enabled,
    // Gated on `enabled`: sitekey non-null ⟺ enforcement on. A bare sitekey
    // with no secret must not invite the client to render a widget whose
    // tokens /redeem would then reject.
    sitekey: enabled ? c.env.TURNSTILE_SITE_KEY : null,
  })
})

/**
 * POST /api/pair/revoke (owner; app with owner-password proof)
 *
 * Mark a paired app revoked. Re-puts with the same TTL so the record still
 * self-prunes ~max-token-age later (a bare put would make it permanent).
 *
 * App-role guards (#26 fast-follow), both because an unlabeled UUID list
 * invites a coin-flip self-destruct that bricks a phone-only deployment:
 * - SELF_REVOKE: the caller cannot revoke its own appId (it would lock
 *   itself out mid-session with no re-pairing surface left).
 * - LAST_DEVICE: the last non-revoked record cannot be revoked — the
 *   deployment must always keep one device that can still mint.
 */
pairRoutes.post("/revoke", zValidator("json", revokeSchema), async (c) => {
  const { appId, password } = c.req.valid("json")
  const key = PAIR_APP_PREFIX + appId

  if (isApp(c)) {
    const failure = await getOwnerProofFailure(c.env, getUserId(c)!, password)
    if (failure) return proofErrorResponse(c, failure)
  }
  // Inert for owners (their sub is "owner", never a record appId).
  if (getUserId(c) === appId) {
    return c.json(
      {
        success: false,
        error: "Cannot revoke the calling device; pair a replacement first",
        errorCode: "SELF_REVOKE",
      },
      409,
    )
  }

  const rec = (await c.env.CONFIG.get(key, "json")) as
    | { appId?: string; pairedAt?: number; revoked?: boolean }
    | null
  if (!rec) {
    return c.json(
      { success: false, error: "App is not paired", errorCode: "APP_NOT_PAIRED" },
      404,
    )
  }

  if (
    isApp(c) &&
    rec.revoked !== true &&
    !(await hasOtherLivePairedApp(c.env.CONFIG, appId))
  ) {
    // Defense in depth: with a consistent KV view the caller's own live
    // record (middleware-checked) always satisfies hasOtherLivePairedApp, so
    // SELF_REVOKE above shadows this guard in practice. It still fires under
    // KV eventual-consistency windows and keeps the invariant if the
    // middleware's revocation contract ever changes: an app-role revoke may
    // never leave the deployment without a live record (mint stays reachable).
    return c.json(
      {
        success: false,
        error: "Cannot revoke the last paired device",
        errorCode: "LAST_DEVICE",
      },
      409,
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
 * Collect paired devices from KV (prefix PAIR_APP_PREFIX), newest-first.
 * KV list is paginated (max 1000 keys/page) — loop the cursor. Records
 * failing the shape check are skipped, not fatal.
 */
async function collectPairedApps(
  config: KVNamespace,
): Promise<{ success: true; apps: { appId: string; pairedAt: number; revoked: boolean }[] }> {
  const apps: { appId: string; pairedAt: number; revoked: boolean }[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await config.list({ prefix: PAIR_APP_PREFIX, cursor })
    // Keys within a page are independent — fetch in parallel so N records
    // cost one KV-read round trip, not N serial awaits.
    const records = await Promise.all(
      page.keys.map(({ name }) =>
        config.get(name, "json") as Promise<
          { appId?: unknown; pairedAt?: unknown; revoked?: unknown } | null
        >,
      ),
    )
    for (const rec of records) {
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
  return { success: true, apps }
}

/**
 * GET /api/pair/apps (owner)
 *
 * List paired devices. Owner-only (not allowlisted) — the app uses the
 * proof-carrying POST variant below.
 */
pairRoutes.get("/apps", async (c) => {
  return c.json(await collectPairedApps(c.env.CONFIG))
})

/**
 * POST /api/pair/apps (app with owner-password proof)
 *
 * Proof-carrying list variant for the native client (#26 fast-follow): GET
 * cannot carry a proof body cleanly, and a bare GET allowlist entry would
 * hand a token-holder the device inventory for free. Same response as the
 * owner GET; every caller (any role) proves with the owner password.
 */
pairRoutes.post("/apps", async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    password?: unknown
  } | null
  const failure = await getOwnerProofFailure(
    c.env,
    getUserId(c) ?? "",
    body?.password,
  )
  if (failure) return proofErrorResponse(c, failure)
  return c.json(await collectPairedApps(c.env.CONFIG))
})

export default pairRoutes
