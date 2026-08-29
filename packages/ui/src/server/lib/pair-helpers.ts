/**
 * Pairing Helpers
 *
 * Claim-code generation, the D1 claim store, app-JWT signing, and Turnstile
 * token verification for Plex-style pairing (ADR-009). Claims are a single-use
 * state machine (`pending -> used`,
 * TTL-bounded) and live in D1: the atomic conditional UPDATE that single-use
 * requires has no KV equivalent (issue #24). JWT signing reuses the ADR-008
 * HS256 + KV-secret auth infrastructure — the same `ensureAuthSecret` +
 * `hono/jwt` `sign()` that `/auth/setup` uses for owner tokens. No second
 * signing key.
 *
 * @packageDocumentation
 */

import { sign } from "hono/jwt"
import { ensureAuthSecret } from "./auth-helpers.js"
import {
  PAIR_APP_PREFIX,
  PAIR_CLAIM_PRUNE_GRACE_SEC,
  PAIR_CLAIM_TTL_SEC,
  PAIR_TOKEN_TTL_SEC,
  SETUP_PASSWORD_KEY,
} from "../constants.js"

/** Crockford Base32 alphabet (excludes I/L/O/U to limit human-entry ambiguity). */
const CLAIM_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const CLAIM_CODE_LEN = 8

/** Current unix time in seconds (shared timestamp convention for pair KV records). */
export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Generate an 8-char Crockford Base32 claim code (~40 bits of entropy).
 *
 * `CLAIM_ALPHABET.length === 32` and `Uint8Array` values are 0–255, so
 * `byte % 32` is unbiased (each char maps to exactly 8 byte values). Uses the
 * Workers Web Crypto `crypto.getRandomValues`.
 */
export function generateClaimCode(): string {
  const buf = new Uint8Array(CLAIM_CODE_LEN)
  crypto.getRandomValues(buf)
  let code = ""
  for (let i = 0; i < CLAIM_CODE_LEN; i++) {
    code += CLAIM_ALPHABET[buf[i]! % CLAIM_ALPHABET.length]
  }
  return code
}

/**
 * Normalize a user-entered claim code: uppercase, then apply Crockford
 * disambiguation (O -> 0, I/L -> 1) so visually-ambiguous entry still matches the
 * canonical stored key.
 */
export function normalizeClaimCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
}

/** D1 schema for the claim store — lazily created, once per isolate. */
const PAIR_CLAIM_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS pair_claim (
    code        TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'pending',
    origin      TEXT,
    created_at  INTEGER NOT NULL,
    app_id      TEXT,
    redeemed_at INTEGER
  )
`

/** Module-level guard: the CREATE IF NOT EXISTS only pays once per isolate. */
let pairClaimTableReady = false

/**
 * Idempotently create the claim table. Called from mint, redeem, and the
 * bootstrap claim read — a fresh deployment (or trial D1) must answer a bogus
 * redeem with 404, not a "no such table" 500.
 */
export async function ensurePairClaimTable(db: D1Database): Promise<void> {
  if (pairClaimTableReady) return
  await db.prepare(PAIR_CLAIM_CREATE_SQL).run()
  pairClaimTableReady = true
}

/**
 * Lazy TTL replacement: D1 has no expirationTtl, so expired rows are deleted
 * with a grace buffer once they can no longer matter (pending past TTL is
 * dead for redeem; used past TTL+grace matches the old KV behavior where the
 * key simply vanished). Rides on mint only — owner-rare and bootstrap mints
 * at most one per claim TTL — never on the public redeem or GET / hot path.
 */
export async function pruneExpiredPairClaims(db: D1Database): Promise<void> {
  const cutoff = nowSec() - PAIR_CLAIM_TTL_SEC - PAIR_CLAIM_PRUNE_GRACE_SEC
  await db
    .prepare("DELETE FROM pair_claim WHERE created_at < ?1")
    .bind(cutoff)
    .run()
}

/**
 * Mint a single-use pending claim — the ONE mint path shared by
 * POST /api/pair/issue (owner dashboard) and the first-run bootstrap surface
 * (issue #21), so the stored shape + TTL semantics cannot drift between them.
 * `origin` marks the mint source (bootstrap passes "bootstrap"; owner mints
 * store NULL).
 */
export async function mintPendingClaim(
  db: D1Database,
  extra: { origin?: string } = {},
): Promise<{ code: string; createdAt: number }> {
  await ensurePairClaimTable(db)
  await pruneExpiredPairClaims(db)
  const code = generateClaimCode()
  const createdAt = nowSec()
  await db
    .prepare(
      "INSERT INTO pair_claim (code, status, origin, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(code, "pending", extra.origin ?? null, createdAt)
    .run()
  return { code, createdAt }
}

/**
 * Sign a long-lived app JWT for a paired device (`role: "app"`).
 *
 * Identical HS256 secret + `hono/jwt` `sign()` call as `/auth/setup`; the
 * middleware's Web-Crypto `verifyToken` already accepts its output.
 */
export async function signAppToken(
  env: { CONFIG: KVNamespace },
  appId: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return sign(
    { sub: appId, role: "app", iat: now, exp: now + PAIR_TOKEN_TTL_SEC },
    await ensureAuthSecret(env),
    "HS256",
  )
}

// --- Owner-password proof (issue #26 / Track C) ------------------------------

/**
 * D1 schema for the owner-password proof throttle — per-appId failure counter
 * with an exponential-backoff lock. Same lazy-create pattern as `pair_claim`.
 */
const PAIR_PROOF_THROTTLE_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS pair_proof_throttle (
    app_id       TEXT PRIMARY KEY,
    failures     INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0
  )
`

let pairProofThrottleTableReady = false

async function ensurePairThrottleTable(db: D1Database): Promise<void> {
  if (pairProofThrottleTableReady) return
  await db.prepare(PAIR_PROOF_THROTTLE_CREATE_SQL).run()
  pairProofThrottleTableReady = true
}

/** Wrong proofs allowed before the lockout kicks in; then exponential backoff. */
const PROOF_FREE_FAILURES = 5
const PROOF_LOCK_MAX_SEC = 15 * 60

/**
 * Seconds the app is still locked out for (0 = not locked). Locked attempts
 * neither verify the password nor grow the counter — the lock decays by time
 * alone, and the NEXT failure after expiry extends it.
 */
export async function proofLockRemaining(
  db: D1Database,
  appId: string,
): Promise<number> {
  await ensurePairThrottleTable(db)
  const row = await db
    .prepare("SELECT failures, locked_until FROM pair_proof_throttle WHERE app_id = ?1")
    .bind(appId)
    .first<{ locked_until: number } | null>()
  return row ? Math.max(0, row.locked_until - nowSec()) : 0
}

/**
 * Count one wrong proof and (from the threshold on) arm the backoff lock.
 * Read-then-upsert is deliberately not atomic — a concurrent pair of failures
 * can undercount by one, which a heuristic backoff tolerates (unlike the claim
 * flip, nothing security-critical rides on the exact count).
 */
export async function recordProofFailure(
  db: D1Database,
  appId: string,
): Promise<void> {
  await ensurePairThrottleTable(db)
  const row = await db
    .prepare("SELECT failures FROM pair_proof_throttle WHERE app_id = ?1")
    .bind(appId)
    .first<{ failures: number } | null>()
  const failures = (row?.failures ?? 0) + 1
  const lockedUntil =
    failures >= PROOF_FREE_FAILURES
      ? nowSec() +
        Math.min(2 ** (failures - PROOF_FREE_FAILURES), PROOF_LOCK_MAX_SEC)
      : 0
  await db
    .prepare(
      `INSERT INTO pair_proof_throttle (app_id, failures, locked_until) VALUES (?1, ?2, ?3)
       ON CONFLICT(app_id) DO UPDATE SET failures = ?2, locked_until = ?3`,
    )
    .bind(appId, failures, lockedUntil)
    .run()
}

/** Clear the failure counter after a successful proof. */
export async function clearProofFailures(
  db: D1Database,
  appId: string,
): Promise<void> {
  await ensurePairThrottleTable(db)
  await db
    .prepare("DELETE FROM pair_proof_throttle WHERE app_id = ?1")
    .bind(appId)
    .run()
}

/** Failure shape of an owner-password proof, mapped 1:1 onto a JSON response. */
export type OwnerProofFailure = {
  status: 400 | 401 | 409 | 429
  error: string
  errorCode: string
  retryAfter?: number
}

/**
 * Verify the owner password carried alongside an app-role request (issue #26:
 * proof-per-request — the app never receives an owner credential, so the
 * password itself is the whole capability). Returns null when the proof is
 * accepted. Order matters: throttle first (a locked caller performs no
 * password read), password second — a wrong password must run BEFORE any mint
 * so failed guesses leave no claim rows behind.
 */
export async function getOwnerProofFailure(
  env: { CONFIG: KVNamespace; DB: D1Database },
  appId: string,
  password: unknown,
): Promise<OwnerProofFailure | null> {
  if (typeof password !== "string" || password.length === 0) {
    return {
      status: 400,
      error: "Owner password is required",
      errorCode: "OWNER_PASSWORD_MISSING",
    }
  }
  const lockRemaining = await proofLockRemaining(env.DB, appId)
  if (lockRemaining > 0) {
    return {
      status: 429,
      error: "Too many failed owner-password attempts; try again later",
      errorCode: "PROOF_THROTTLED",
      retryAfter: lockRemaining,
    }
  }
  const stored = (await env.CONFIG.get(SETUP_PASSWORD_KEY)) as string | null
  if (!stored) {
    return {
      status: 409,
      error:
        "Owner password not set; establish it first via POST /api/pair/establish-owner",
      errorCode: "OWNER_PASSWORD_REQUIRED",
    }
  }
  if (password !== stored) {
    await recordProofFailure(env.DB, appId)
    return {
      status: 401,
      error: "Invalid owner password",
      errorCode: "OWNER_PASSWORD_INVALID",
    }
  }
  await clearProofFailures(env.DB, appId)
  return null
}

/**
 * Whether any non-revoked pairing record still exists (middleware semantics:
 * record present and `revoked !== true`). Gates the /auth/setup ownerless
 * closure — an all-revoked/all-expired deployment is abandoned and stays
 * recoverable by first-caller setup. Reads pages until the first live record.
 */
export async function hasLivePairedApp(kv: KVNamespace): Promise<boolean> {
  let cursor: string | undefined
  for (;;) {
    const page = await kv.list({ prefix: PAIR_APP_PREFIX, cursor })
    const records = await Promise.all(
      page.keys.map(({ name }) =>
        kv.get(name, "json") as Promise<{ revoked?: unknown } | null>,
      ),
    )
    if (records.some((rec) => rec && rec.revoked !== true)) return true
    if (page.list_complete === false) cursor = page.cursor
    else break
  }
  return false
}

/** Cloudflare Turnstile server-side verification endpoint. */
const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify"
const TURNSTILE_VERIFY_TIMEOUT_MS = 5000

/**
 * Outcome of a siteverify call. "unavailable" = network error, timeout, or
 * non-200 HTTP (owner-side problem — surface as 503, not a client "invalid").
 */
export type TurnstileVerdict = "ok" | "invalid" | "unavailable"

/**
 * Verify a Turnstile widget token server-side (issue #23: brute-force pressure
 * on the public redeem must not stay free once QR/links made codes
 * machine-readable). Never throws — the tri-state verdict IS the error channel,
 * which keeps the redeem handler a flat three-branch gate. `remoteip` is
 * omitted: the Worker only sees CF edge IPs, so passing it risks false
 * "invalid"s for a code that is already single-use + 10-min TTL.
 */
export async function verifyTurnstileToken(
  secret: string,
  token: string,
): Promise<TurnstileVerdict> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TURNSTILE_VERIFY_TIMEOUT_MS)
  try {
    const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token }),
      signal: controller.signal,
    })
    if (!response.ok) return "unavailable"
    const data = (await response.json()) as { success?: boolean }
    return data.success === true ? "ok" : "invalid"
  } catch {
    return "unavailable"
  } finally {
    clearTimeout(timeoutId)
  }
}
