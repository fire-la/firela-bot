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
  PAIR_CLAIM_PRUNE_GRACE_SEC,
  PAIR_CLAIM_TTL_SEC,
  PAIR_TOKEN_TTL_SEC,
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
