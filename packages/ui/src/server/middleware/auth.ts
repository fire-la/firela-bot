/**
 * JWT Authentication Middleware
 *
 * Protects API routes using stateless JWT authentication.
 * Webhook routes are excluded (they use HMAC signature verification).
 *
 * Migrated from packages/billclaw/worker/src/middleware/auth.ts
 *
 * @packageDocumentation
 */

import { createMiddleware } from "hono/factory"
import { ensureAuthSecret } from "../lib/auth-helpers.js"
import { APP_ROLE_ALLOWLIST, PAIR_APP_PREFIX } from "../constants.js"
import type { Env } from "../index.js"

/**
 * Paths excluded from JWT authentication.
 *
 * Matched as exact OR exact+"/" (never bare `startsWith`) so that adding
 * "/api/pair/redeem" here cannot accidentally expose "/api/pair/redeemXXX".
 * Mirrors the safe pattern in middleware/service-toggle.ts. Hono collapses ".."
 * in `c.req.path` before middleware runs, so traversal is not a bypass here.
 */
const PUBLIC_PATHS = [
  "/health",
  "/auth", // Auth routes (including /auth/setup)
  "/webhook", // Webhook routes (use HMAC verification)
  "/api/pair/redeem", // Public pairing redemption (the claim code is the auth)
  "/api/relay/health", // Pre-login relay probe (Gmail relay-only flow)
]

/**
 * Check if a path is public (excluded from JWT auth).
 *
 * "/" matches exactly; other entries match exactly or as a "dir/" prefix
 * (so "/auth" covers "/auth/setup" but not "/authentication").
 */
function isPublicPath(path: string): boolean {
  if (path === "/") return true
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"))
}

/**
 * Normalize a path for app-role allowlist comparison: strip one trailing "/"
 * (except root). Deliberately NOT lowercased — Hono route matching is
 * case-sensitive, and odd variants (//, %2f) already 404 at the route layer.
 */
function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1)
  return path
}

/**
 * Whether an `app`-role token may reach `(method, path)`.
 * Method-aware so a read path (GET /api/config) does not silently grant its
 * destructive sibling (PUT /api/config). See APP_ROLE_ALLOWLIST.
 *
 * Pattern syntax: an allowlist segment written as `:name` matches exactly one
 * non-empty request path segment (e.g. `/api/accounts/:id` allows
 * `/api/accounts/abc` but NOT `/api/accounts` or `/api/accounts/a/b`).
 * Everything else is a literal segment compared for equality. Semantics
 * preserved from the exact-match era (#19):
 * - Fail-closed: no entry match -> deny.
 * - Hono collapses ".." in `c.req.path` before middleware runs (see
 *   PUBLIC_PATHS comment), so traversal resolves to its collapsed form and
 *   must still match an entry literally to pass.
 * - `normalizePath` (trailing-slash strip, no case folding) applies first.
 */
function isAppAllowed(method: string, path: string): boolean {
  const norm = normalizePath(path)
  return APP_ROLE_ALLOWLIST.some((e) => {
    if (e.method !== method) return false
    const entrySegs = e.path.split("/")
    const pathSegs = norm.split("/")
    if (entrySegs.length !== pathSegs.length) return false
    return entrySegs.every(
      (seg, i) => (seg.startsWith(":") ? pathSegs[i] !== "" : seg === pathSegs[i]),
    )
  })
}

/**
 * Verify a JWT token using Web Crypto API
 */
async function verifyToken(
  token: string,
  secret: string,
): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) {
      return null
    }

    const [headerB64, payloadB64, signatureB64] = parts

    // Decode header and payload
    const header = JSON.parse(atob(headerB64))
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")))

    // Check algorithm
    if (header.alg !== "HS256") {
      return null
    }

    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    // Verify signature using Web Crypto API
    const encoder = new TextEncoder()
    const keyData = encoder.encode(secret)
    const messageData = encoder.encode(`${headerB64}.${payloadB64}`)

    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    )

    // Decode base64url signature
    const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    )

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      messageData,
    )

    return isValid ? payload : null
  } catch {
    return null
  }
}

/**
 * JWT authentication middleware
 *
 * This middleware:
 * 1. Skips authentication for public paths (health, auth, webhooks)
 * 2. Validates JWT token for protected paths
 * 3. Returns 401 for invalid or missing tokens
 *
 * Usage:
 * ```typescript
 * app.use('/api/*', authMiddleware)
 * ```
 */
export const authMiddleware = createMiddleware<{ Bindings: Env }>(
  async (c, next) => {
    const path = c.req.path

    // Skip authentication for public paths
    if (isPublicPath(path)) {
      return next()
    }

    // Get or auto-generate JWT secret (env var > KV > auto-generate)
    const jwtSecret = await ensureAuthSecret(c.env)

    // Check for Authorization header
    const authHeader = c.req.header("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json(
        {
          success: false,
          error: "Missing or invalid Authorization header",
          errorCode: "AUTH_MISSING",
        },
        401,
      )
    }

    const token = authHeader.slice(7)
    const payload = await verifyToken(token, jwtSecret)

    if (!payload) {
      return c.json(
        {
          success: false,
          error: "Invalid or expired token",
          errorCode: "AUTH_INVALID",
        },
        401,
      )
    }

    // --- Role-based authorization -----------------------------------------
    // Today every valid JWT had full access and `isOwner()` was dead code. PR-3
    // makes role enforcement real and fail-closed.
    const role = payload.role as string | undefined

    if (role === "owner") {
      // Owner: full access, unchanged. (No revocation KV read for owners.)
      c.set("jwtPayload", payload)
      return next()
    }

    if (role === "app") {
      // App tokens may reach ONLY the method+path allowlist. Check BEFORE any KV
      // read so a denied request performs zero KV operations.
      if (!isAppAllowed(c.req.method, normalizePath(path))) {
        return c.json(
          {
            success: false,
            error: "App role is not permitted to access this path",
            errorCode: "APP_ROLE_PATH_DENIED",
          },
          403,
        )
      }

      // Revocation check (D2, fail-closed). A KV GET on a missing key returns
      // null (not a throw); a throw implies infra failure -> deny, never pass.
      let rec: { revoked?: boolean } | null
      try {
        rec = await c.env.CONFIG.get(
          PAIR_APP_PREFIX + (payload.sub as string),
          "json",
        )
      } catch {
        return c.json(
          {
            success: false,
            error: "Revocation check failed",
            errorCode: "AUTH_REVOCATION_CHECK_FAILED",
          },
          401,
        )
      }

      if (rec === null) {
        return c.json(
          {
            success: false,
            error: "App is not paired",
            errorCode: "APP_NOT_PAIRED",
          },
          401,
        )
      }
      if (rec.revoked === true) {
        return c.json(
          {
            success: false,
            error: "Token has been revoked",
            errorCode: "AUTH_REVOKED",
          },
          401,
        )
      }

      c.set("jwtPayload", payload)
      return next()
    }

    // Unknown or missing role: deny (fail-closed) even with a valid signature.
    return c.json(
      {
        success: false,
        error: "Invalid or missing role in token",
        errorCode: "AUTH_INVALID_ROLE",
      },
      403,
    )
  },
)

/**
 * Extract user ID from JWT payload
 *
 * This helper can be used in route handlers to get the authenticated user.
 */
export function getUserId(c: {
  get: (key: string) => Record<string, unknown> | undefined
}): string | null {
  const payload = c.get("jwtPayload")
  return (payload?.sub as string) || null
}

/**
 * Check if user has owner role
 *
 * The owner role is granted during initial setup and has full access.
 */
export function isOwner(c: {
  get: (key: string) => Record<string, unknown> | undefined
}): boolean {
  const payload = c.get("jwtPayload")
  return (payload?.role as string) === "owner"
}

/**
 * Check if the caller holds the app role (the native client's pairing JWT —
 * ADR-009). Surfaces that proxy sensitive payloads strip them for app
 * callers (credential custody stays server-side).
 */
export function isApp(c: {
  get: (key: string) => Record<string, unknown> | undefined
}): boolean {
  const payload = c.get("jwtPayload")
  return (payload?.role as string) === "app"
}
