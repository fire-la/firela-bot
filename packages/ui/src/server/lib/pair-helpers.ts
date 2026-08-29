/**
 * Pairing Helpers
 *
 * Claim-code generation and app-JWT signing for Plex-style pairing (ADR-009).
 * Reuses the ADR-008 HS256 + KV-secret auth infrastructure — the same
 * `ensureAuthSecret` + `hono/jwt` `sign()` that `/auth/setup` uses for owner
 * tokens. No second signing key.
 *
 * @packageDocumentation
 */

import { sign } from "hono/jwt"
import { ensureAuthSecret } from "./auth-helpers.js"
import { PAIR_CLAIM_PREFIX, PAIR_CLAIM_TTL_SEC, PAIR_TOKEN_TTL_SEC } from "../constants.js"

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

/**
 * Mint a single-use pending claim — the ONE mint path shared by
 * POST /api/pair/issue (owner dashboard) and the first-run bootstrap surface
 * (issue #21), so the KV shape + TTL cannot drift between them. `extra`
 * fields merge into the stored record (bootstrap passes `origin`).
 */
export async function mintPendingClaim(
  kv: KVNamespace,
  extra: Record<string, unknown> = {},
): Promise<{ code: string; createdAt: number }> {
  const code = generateClaimCode()
  const createdAt = nowSec()
  await kv.put(
    PAIR_CLAIM_PREFIX + code,
    JSON.stringify({ status: "pending", createdAt, ...extra }),
    { expirationTtl: PAIR_CLAIM_TTL_SEC },
  )
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
