/**
 * Auth Helpers
 *
 * Utilities for JWT secret management with KV-backed auto-generation.
 * On first run, secrets are generated and stored in the CONFIG KV namespace
 * so users don't need to manually configure JWT_SECRET or SETUP_PASSWORD.
 *
 * @packageDocumentation
 */

import { AUTH_SECRET_KEY } from "../constants.js"

/**
 * Get JWT signing secret from KV storage.
 *
 * Returns null if not configured.
 */
export async function getAuthSecret(env: { CONFIG: KVNamespace }): Promise<string | null> {
  const stored = await env.CONFIG.get(AUTH_SECRET_KEY)
  return stored || null
}

/**
 * Get or create JWT signing secret.
 *
 * Checks KV first. If not found, generates a new 32-byte hex secret
 * and stores it in KV for future requests.
 */
export async function ensureAuthSecret(env: { CONFIG: KVNamespace }): Promise<string> {
  const stored = await env.CONFIG.get(AUTH_SECRET_KEY)
  if (stored) return stored

  const generated = generateSecret()
  await env.CONFIG.put(AUTH_SECRET_KEY, generated)
  return generated
}

/**
 * Generate a cryptographically random 32-byte hex string.
 *
 * Uses Web Crypto API (available in Cloudflare Workers).
 */
function generateSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Constant-time string equality, shared by every SETUP_PASSWORD_KEY compare
 * site (/auth/setup, PUT /api/settings/password, the pair owner-proof).
 *
 * Both sides are SHA-256-digested first so the XOR loop compares fixed-length
 * digests (no length leak) and stays on portable Web Crypto — the
 * Cloudflare-only crypto.subtle.timingSafeEqual is absent under Vitest's
 * Node webcrypto. One helper for all sites per the 2fd30ce note: patching a
 * single site would be inconsistent across sites sharing the same secret.
 */
export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ])
  const va = new Uint8Array(da)
  const vb = new Uint8Array(db)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!
  return diff === 0
}
