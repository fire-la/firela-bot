/**
 * Authentication Routes
 *
 * Provides endpoints for JWT token management.
 *
 * Migrated from packages/billclaw/worker/src/routes/auth.ts
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import { sign, verify } from "hono/jwt"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import type { Env } from "../index.js"
import {
  PAIR_BOOTSTRAP_DONE_KEY,
  SETUP_PASSWORD_KEY,
} from "../constants.js"
import { getAuthSecret, ensureAuthSecret, timingSafeEqualStr } from "../lib/auth-helpers.js"
import {
  clearProofFailures,
  hasLivePairedApp,
  proofLockRemaining,
  recordProofFailure,
} from "../lib/pair-helpers.js"

export const authRoutes = new Hono<{ Bindings: Env }>()

/**
 * Request schema for POST /auth/setup
 */
const setupRequestSchema = z.object({
  password: z.string().min(1, "Password is required"),
})

/**
 * POST /auth/setup
 *
 * One-time setup endpoint to generate the initial JWT token.
 *
 * This endpoint is used during initial deployment to generate
 * a long-lived JWT token for the owner. The token can then be
 * used for all subsequent API calls.
 *
 * Request body:
 * - password: The setup password. On first call (no password configured),
 *   the provided password is stored and becomes the permanent setup password.
 *   Subsequent calls must match this password.
 *
 * Response:
 * - success: true
 * - token: JWT token (valid for 1 year)
 * - expiresIn: Token expiration time in seconds
 *
 * Security:
 * - JWT_SECRET is auto-generated on first run if not set via env var
 * - The first password provided becomes the permanent setup password
 * - The generated JWT is long-lived (1 year) for self-hosted convenience
 */
authRoutes.post("/setup", zValidator("json", setupRequestSchema), async (c) => {
  const { password } = c.req.valid("json")
  const env = c.env

  // Anonymous-oracle throttle (issue #29 precondition): /auth/setup doubles
  // as SPA login, so wrong-password attempts are an unauthenticated guessing
  // surface. Same D1 failure counter + exponential backoff as the app proof
  // path, keyed by client IP instead of appId.
  // ponytail: if the deployment topology hides the real client IP (see the
  // Turnstile remoteip note in pair-helpers), anonymous callers share one
  // bucket — worst case the endpoint is DoS-lockable for 15 min while the
  // app-side proof path (keyed by appId) stays open.
  const throttleKey = `setup:${c.req.header("CF-Connecting-IP") ?? "unknown"}`
  const lockRemaining = await proofLockRemaining(env.DB, throttleKey)
  if (lockRemaining > 0) {
    return c.json(
      {
        success: false,
        error: "Too many failed setup attempts; try again later",
        errorCode: "SETUP_THROTTLED",
        retryAfter: lockRemaining,
      },
      429,
      { "Retry-After": String(lockRemaining) },
    )
  }

  // Get or auto-generate JWT secret
  const jwtSecret = await ensureAuthSecret(env)

  // Password check: KV stored > first-time auto-lock
  const storedPassword = await env.CONFIG.get(SETUP_PASSWORD_KEY) as string | null
  if (!storedPassword) {
    // Ownerless closure (issue #26 bundled fix): first-caller setup is only
    // legal while the deployment is fresh (no redeem yet) or fully abandoned
    // (every pairing record expired/revoked — the deployment is dead and
    // first-caller setup is the only recovery). Once an app has redeemed and a
    // live pairing record exists, ownership is established from the paired app
    // (POST /api/pair/establish-owner) — an anonymous URL holder must not be
    // able to claim a running deployment at any time. Two single-key GETs
    // short-circuit; the KV prefix walk runs only when both are set.
    if (
      (await env.CONFIG.get(PAIR_BOOTSTRAP_DONE_KEY)) &&
      (await hasLivePairedApp(env.CONFIG))
    ) {
      return c.json(
        {
          success: false,
          error:
            "Setup is closed on this deployment; set the owner password from a paired app (Settings > Add device)",
          errorCode: "SETUP_CLOSED",
        },
        403,
      )
    }
    // First call: accept any password and store it for future verification
    await env.CONFIG.put(SETUP_PASSWORD_KEY, password)
  } else if (!(await timingSafeEqualStr(password, storedPassword))) {
    await recordProofFailure(env.DB, throttleKey)
    return c.json(
      {
        success: false,
        error: "Invalid setup password",
        errorCode: "SETUP_INVALID_PASSWORD",
      },
      401,
    )
  }
  await clearProofFailures(env.DB, throttleKey)

  // Create JWT payload
  const now = Math.floor(Date.now() / 1000)
  const expiresIn = 365 * 24 * 60 * 60 // 1 year in seconds

  const payload = {
    sub: "owner", // User ID
    role: "owner", // Full access role
    iat: now,
    exp: now + expiresIn,
  }

  // Sign the JWT with HS256 algorithm
  const token = await sign(payload, jwtSecret, "HS256")

  return c.json({
    success: true,
    token,
    expiresIn,
    tokenType: "Bearer",
    user: {
      id: "owner",
      role: "owner",
    },
  })
})

/**
 * POST /auth/verify
 *
 * Verify a JWT token and return its payload.
 *
 * This endpoint can be used to check if a token is still valid.
 *
 * Request header:
 * - Authorization: Bearer <token>
 *
 * Response:
 * - success: true
 * - payload: Decoded JWT payload
 */
authRoutes.post("/verify", async (c) => {
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

  try {
    const token = authHeader.slice(7)
    const jwtSecret = await getAuthSecret(c.env)
    if (!jwtSecret) {
      return c.json(
        {
          success: false,
          error: "Auth not configured",
          errorCode: "AUTH_NOT_CONFIGURED",
        },
        503,
      )
    }
    const payload = await verify(token, jwtSecret, "HS256")

    return c.json({
      success: true,
      payload: {
        sub: payload.sub,
        role: payload.role,
        iat: payload.iat,
        exp: payload.exp,
      },
    })
  } catch {
    return c.json(
      {
        success: false,
        error: "Invalid or expired token",
        errorCode: "AUTH_INVALID",
      },
      401,
    )
  }
})

/**
 * GET /auth/status
 *
 * Get authentication status and configuration info.
 */
authRoutes.get("/status", async (c) => {
  const jwtSecret = await getAuthSecret(c.env)
  return c.json({
    success: true,
    configured: !!jwtSecret,
    authType: "jwt",
    setupRequired: false,
  })
})
