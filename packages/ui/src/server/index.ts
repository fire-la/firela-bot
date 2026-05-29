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

// CORS - allows frontend to make API requests
app.use(
  cors({
    origin: "*",
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

// Auth routes (including /auth/setup for initial token)
import { authRoutes } from "./routes/auth.js"
app.route("/auth", authRoutes)

// Webhook routes (no JWT auth - uses HMAC signature verification)
import { webhookRoutes } from "./routes/webhooks.js"
app.route("/webhook", webhookRoutes)

// Relay routes (health check needed before login for Gmail relay-only flow)
import { relayRoutes } from "./routes/relay.js"
app.route("/api/relay", relayRoutes)

// OAuth routes (accessible without JWT for OAuth callback flows)
import plaidRoutes from "./routes/oauth/plaid.js"
import credentialsRoutes from "./routes/oauth/credentials.js"
import { gocardlessRoutes } from "./routes/oauth/gocardless.js"
app.route("/api/oauth/plaid", plaidRoutes)
app.route("/api/connect", credentialsRoutes)
app.route("/api/oauth/gocardless", gocardlessRoutes)

// ============================================================================
// Protected Routes (JWT authentication required)
// ============================================================================

// Apply JWT authentication middleware to all /api/* routes
// Note: /api/relay/* and /api/oauth/* are registered above and skip this middleware
app.use("/api/*", authMiddleware)

// Apply service toggle middleware — blocks routes for disabled services (503)
app.use("/api/*", serviceToggleMiddleware())

// ============================================================================
// API Routes
// ============================================================================

// Cache routes (statistics and management)
import { cacheRoutes } from "./routes/cache.js"
app.route("/api/cache", cacheRoutes)

// Service toggle routes (Plan 13.4-01)
import { serviceRoutes } from "./routes/services.js"
app.route("/api/services", serviceRoutes)

// Sync status routes (Plan 13.3.1-01)
import { syncRoutes } from "./routes/sync.js"
app.route("/api/sync", syncRoutes)

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
 * export the Hono app for Cloudflare Workers runtime
 */
export default app
export type AppType = typeof app
