/**
 * BillClaw UI - Hono Server Entry Point
 *
 * Unified server for Cloudflare Workers deployment.
 * Provides both API routes and serves the React SPA.
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { authMiddleware } from "./middleware/auth.js"
import { serviceToggleMiddleware } from "./middleware/service-toggle.js"

/**
 * Environment bindings for Cloudflare Workers
 *
 * All bindings are optional to support zero-config deploy (Relay mode).
 * Fallback defaults are provided via constants.ts.
 */
export type Env = {
  DB: D1Database
  CONFIG: KVNamespace
  ASSETS?: Fetcher
  // Plaid (optional: sandbox/production toggle)
  PLAID_ENV?: string
  // Service toggles (optional: default true)
  BILLCLAW_ENABLED?: string
  FIRELA_BOT_ENABLED?: string
  // Relay (optional: defaults to production relay)
  FIRELA_RELAY_URL?: string
  // Cloudflare management (optional: for upgrade/uninstall from UI)
  GITHUB_TOKEN?: string
  APP_VERSION?: string
}

/**
 * Main Hono application with type bindings
 */
const app = new Hono<{ Bindings: Env }>()

// ============================================================================
// Global Middleware
// ============================================================================

// Request logging
app.use("*", logger())

// CORS - reflect requesting origin so credentials work on any user domain
app.use(
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
  }),
)

// ============================================================================
// Health Check
// ============================================================================

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "firela-bot",
    version: "0.0.1",
  })
})

// ============================================================================
// Public Routes (no authentication required)
// ============================================================================

// First-run bootstrap surface (ADR-009 Decision C, issue #21) — plain-text
// one-time pairing page on a fresh deployment; delegates to notFound (SPA
// fallback) otherwise. Only reachable because wrangler.toml [assets] sets
// run_worker_first = ["/"] — without it the assets layer serves "/" directly.
import { bootstrapRoutes } from "./routes/bootstrap.js"
app.route("/", bootstrapRoutes)

// Auth routes (including /auth/setup for initial token)
import { authRoutes } from "./routes/auth.js"
app.route("/auth", authRoutes)

// Webhook routes (no JWT auth - uses HMAC signature verification)
import { webhookRoutes } from "./routes/webhooks.js"
app.route("/webhook", webhookRoutes)

// ============================================================================
// Protected Routes (JWT authentication required)
// ============================================================================

// Apply JWT auth + service-toggle to ALL /api/* routes BEFORE the mounts below.
// Hono middleware only wraps routes registered AFTER it, so every /api/* mount
// (including oauth/connect/relay) must come after these. Previously
// oauth/connect/relay were mounted above this line and ran UNGATED — a public
// credential-mint exposure (POST /api/oauth/plaid/exchange persisted a Plaid
// token with no auth); PR-4 moves them behind auth.
//   - /api/relay/health stays public via PUBLIC_PATHS (pre-login probe).
//   - /api/pair/redeem stays public via PUBLIC_PATHS (claim code is the auth).
app.use("/api/*", authMiddleware)
app.use("/api/*", serviceToggleMiddleware())

// ============================================================================
// API Routes
// ============================================================================

// Relay routes — /health is public (PUBLIC_PATHS); /connect/* is auth-gated.
import { relayRoutes } from "./routes/relay.js"
app.route("/api/relay", relayRoutes)

// OAuth/connect routes — now auth-gated. Bank-connect credential-mint paths
// (POST /api/oauth/plaid/exchange, POST /api/connect/*) are owner-only — denied
// to the app role by APP_ROLE_ALLOWLIST (method+path).
import plaidRoutes from "./routes/oauth/plaid.js"
import credentialsRoutes from "./routes/oauth/credentials.js"
import { gocardlessRoutes } from "./routes/oauth/gocardless.js"
app.route("/api/oauth/plaid", plaidRoutes)
app.route("/api/connect", credentialsRoutes)
app.route("/api/oauth/gocardless", gocardlessRoutes)

// Cache routes (statistics and management)
import { cacheRoutes } from "./routes/cache.js"
app.route("/api/cache", cacheRoutes)

// Service toggle routes (Plan 13.4-01)
import { serviceRoutes } from "./routes/services.js"
app.route("/api/services", serviceRoutes)

// Sync status routes (Plan 13.3.1-01)
import { syncRoutes } from "./routes/sync.js"
app.route("/api/sync", syncRoutes)

// Pairing routes (ADR-009 PR-3) — /redeem is public via PUBLIC_PATHS in
// authMiddleware; /issue + /revoke are owner-only (not in APP_ROLE_ALLOWLIST).
import { pairRoutes } from "./routes/pair.js"
app.route("/api/pair", pairRoutes)

// Accounts routes (Plan 13.3.3-02)
import { accountsRoutes } from "./routes/accounts.js"
app.route("/api/accounts", accountsRoutes)

// Config routes (config management, system status, test endpoints)
import { configRoutes } from "./routes/config.js"
app.route("/api", configRoutes)

// Cloudflare management routes (upgrade/uninstall from UI)
import { cloudflareRoutes } from "./routes/cloudflare.js"
app.route("/api/cloudflare", cloudflareRoutes)

// ============================================================================
// SPA Fallback - handled by Cloudflare Workers Assets
// ============================================================================
// Cloudflare Workers handles SPA routing automatically via wrangler.toml:
// [assets]
// directory = "dist"
// not_found_handling = "single-page-application"
//
// This means:
// - Static assets are served from dist/ automatically
// - For SPA routes (non-API, non-static), Cloudflare returns dist/index.html
// - The built index.html already contains correct asset hashes from Vite

app.notFound(async (c) => {
  const path = c.req.path

  // For API routes, return JSON 404 error
  if (
    path.startsWith("/api/") ||
    path.startsWith("/auth/") ||
    path.startsWith("/webhook/") ||
    path === "/health"
  ) {
    return c.json(
      {
        success: false,
        error: "Not Found",
        errorCode: "NOT_FOUND",
        path: path,
      },
      404,
    )
  }

  // For SPA routes, serve index.html from ASSETS binding
  // This handles client-side routing for React SPA
  if (c.env.ASSETS) {
    try {
      // Use ASSETS binding to fetch index.html
      const indexUrl = new URL("/index.html", c.req.url)
      const asset = await c.env.ASSETS.fetch(indexUrl)
      if (asset.ok) {
        return new Response(asset.body, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        })
      }
    } catch {
      // Fall through to 404
    }
  }

  // Fallback: return 404 without body
  // wrangler's not_found_handling = "single-page-application" should handle this
  return new Response(null, { status: 404 })
})

// Global error handler
app.onError((err, c) => {
  console.error("Error:", err)
  return c.json(
    {
      success: false,
      error: err.message || "Internal Server Error",
      errorCode: "INTERNAL_ERROR",
    },
    500,
  )
})

/**
 * Cloudflare Workers entrypoint.
 *
 * `fetch` serves the Hono app; `scheduled` runs the Plaid -> VLT sync job on the
 * cron defined in wrangler.toml. The sync job is imported dynamically so it stays
 * out of the fetch-path module graph.
 */
export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    // Wrap BOTH the dynamic import and the job in waitUntil so a module-load
    // failure or a top-level throw (e.g. getVltJwt / getPlaidRelayClient) is
    // caught and logged, not an unhandled rejection that fails the invocation.
    ctx.waitUntil(
      import("./jobs/sync-job.js")
        .then((mod) => mod.runSyncJob(env))
        .catch((err) => console.error("[sync-job] fatal:", err)),
    )
  },
}

export type AppType = typeof app
