/**
 * Config API Routes
 *
 * REST API endpoints for configuration management.
 * Uses KV namespace for configuration storage in Cloudflare Workers.
 *
 * Migrated from Express (packages/connect/src/routes/config.ts) to Hono.
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import type { Env } from "../index.js"
import { serverCache, CacheKeys } from "../lib/server-cache.js"
import { RELAY_API_KEY_KEY, SETUP_PASSWORD_KEY, CF_API_TOKEN_KEY } from "../constants.js"
import { getRelayApiKey } from "../lib/relay-helpers.js"
import { getCloudflareApiToken } from "../lib/cloudflare-helpers.js"
import { isApp } from "../middleware/auth.js"
import { maskApiKey } from "@firela/billclaw-core/relay"

export const configRoutes = new Hono<{ Bindings: Env }>()

// KV key for config storage
const CONFIG_KEY = "billclaw:config"

/**
 * Mask sensitive configuration fields
 */
function maskConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const masked = { ...config }

  // Mask Plaid secret
  if (masked.plaid && typeof masked.plaid === "object") {
    masked.plaid = {
      ...masked.plaid,
      secret: (masked.plaid as Record<string, unknown>).secret
        ? "***"
        : undefined,
    }
  }

  // Mask VLT API token
  if (masked.vlt && typeof masked.vlt === "object") {
    const vlt = masked.vlt as Record<string, unknown>
    masked.vlt = {
      ...vlt,
      accessToken: vlt.accessToken ? "***" : undefined,
    }
  }

  // Mask account-level sensitive data
  if (Array.isArray(masked.accounts)) {
    masked.accounts = masked.accounts.map((account) => {
      const acc = account as Record<string, unknown>
      return {
        ...acc,
        plaidAccessToken: acc.plaidAccessToken ? "***" : undefined,
        gocardlessAccessToken: acc.gocardlessAccessToken ? "***" : undefined,
        gmailAccessToken: acc.gmailAccessToken ? "***" : undefined,
      }
    })
  }

  return masked
}

// Schema for config update
const configUpdateSchema = z.record(z.unknown())

/**
 * GET /api/config
 * Returns the current configuration with sensitive fields masked
 */
configRoutes.get("/config", async (c) => {
  try {
    // Check if CONFIG KV namespace is available
    if (!c.env.CONFIG) {
      return c.json({
        success: true,
        data: {},
        message: "KV storage not configured",
      })
    }

    // Try cache first, fall back to KV
    let config = serverCache.get<Record<string, unknown>>(CacheKeys.config)
    if (!config) {
      const raw = await c.env.CONFIG.get(CONFIG_KEY, "json")
      if (!raw) {
        return c.json({
          success: true,
          data: {},
        })
      }
      config = raw as Record<string, unknown>
      serverCache.set(CacheKeys.config, config)
    }

    const masked = maskConfig(config)
    return c.json({ success: true, data: masked })
  } catch (error) {
    return c.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to load config",
      },
      500,
    )
  }
})

/**
 * Deep-merge a partial config update into the stored config, mask-aware:
 * - a leaf string exactly "***" is SKIPPED (the masked GET prefills SPA forms;
 *   echoing a mask back must never overwrite the live secret)
 * - an explicit JSON null DELETES the key (the only deletion mechanism —
 *   omitting a key preserves it)
 * - arrays and other non-object leaves replace atomically (no index merge;
 *   note the "***"-skip applies to OBJECT leaves only — no writer legitimately
 *   PUTs credential-bearing arrays, which the server alone writes)
 *
 * Callers send only the subsection they edit; object sub-sections merge by
 * key, so a key that must disappear is sent as null.
 */
function deepMergeConfig(existing: unknown, partial: unknown): unknown {
  if (
    partial === null ||
    typeof partial !== "object" ||
    Array.isArray(partial)
  ) {
    return partial
  }
  const base =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}
  for (const [key, value] of Object.entries(
    partial as Record<string, unknown>,
  )) {
    // Skip prototype-chain keys: plain assignment would hit the __proto__
    // setter instead of creating an own property (predictability, not a real
    // pollution vector in workerd).
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue
    }
    if (value === null) {
      delete base[key]
      continue
    }
    if (value === "***") {
      continue
    }
    base[key] = deepMergeConfig(base[key], value)
  }
  return base
}

/**
 * Whether any value in the payload is an explicit JSON null (the delete
 * marker). Used to keep app-role PUTs from wiping sections they cannot even
 * read — null-deletion is owner-only.
 */
function containsNull(value: unknown): boolean {
  if (value === null) return true
  if (Array.isArray(value)) return value.some(containsNull)
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsNull)
  }
  return false
}

/**
 * PUT /api/config
 * Updates the configuration (deep-merge; see deepMergeConfig)
 */
configRoutes.put(
  "/config",
  zValidator("json", configUpdateSchema),
  async (c) => {
    try {
      // Check if CONFIG KV namespace is available
      if (!c.env.CONFIG) {
        return c.json(
          {
            success: false,
            error: "KV storage not configured",
          },
          400,
        )
      }

      const partial = c.req.valid("json")
      // Null-deletion (the only way to remove a key) is owner-only: an app
      // token must not be able to wipe sections it cannot even read.
      if (isApp(c) && containsNull(partial)) {
        return c.json(
          {
            success: false,
            error: "App role cannot delete config keys",
          },
          400,
        )
      }
      const existing = await c.env.CONFIG.get(CONFIG_KEY, "json")
      const config = deepMergeConfig(existing ?? {}, partial)
      await c.env.CONFIG.put(CONFIG_KEY, JSON.stringify(config))
      // Invalidate cache after write
      serverCache.delete(CacheKeys.config)
      return c.json({ success: true })
    } catch (error) {
      return c.json(
        {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to update config",
        },
        400,
      )
    }
  },
)

/**
 * GET /api/system/status
 * Returns system status information
 */
configRoutes.get("/system/status", async (c) => {
  try {
    return c.json({
      success: true,
      data: {
        version: "0.0.1",
        platform: "cloudflare-workers",
        runtime: "edge",
        configPath: "KV:billclaw:config",
      },
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get system status",
      },
      500,
    )
  }
})

/**
 * POST /api/export/test
 * Validates export configuration
 */
configRoutes.post("/export/test", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      format?: string
      filePrefix?: string
    }
    const { format, filePrefix } = body

    // Validate export format
    const validFormats = ["beancount", "ledger"]
    if (format && !validFormats.includes(format)) {
      return c.json(
        {
          success: false,
          error: "Invalid export format",
        },
        400,
      )
    }

    // Note: In Cloudflare Workers, file system operations are not available
    // We can only validate the format and structure

    // Validate file prefix is valid filename
    if (filePrefix) {
      const validPrefixRegex = /^[a-zA-Z0-9_-]+$/
      if (!validPrefixRegex.test(filePrefix)) {
        return c.json(
          {
            success: false,
            error: "Invalid file prefix",
          },
          400,
        )
      }
    }

    return c.json({
      success: true,
      message: "Export configuration is valid",
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to test configuration",
      },
      500,
    )
  }
})

/**
 * POST /api/vlt/test
 * Validates VLT (Firela Vault) configuration
 */
configRoutes.post("/vlt/test", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      apiUrl?: string
      accessToken?: string
      region?: string
    }
    const { apiUrl, accessToken, region } = body

    const validRegions = ["cn", "us", "eu-core", "de"]
    if (region && !validRegions.includes(region)) {
      return c.json(
        {
          success: false,
          error: "Invalid region",
        },
        400,
      )
    }

    // Validate API URL
    if (apiUrl) {
      try {
        new URL(apiUrl)
      } catch {
        return c.json(
          {
            success: false,
            error: "Invalid API URL",
          },
          400,
        )
      }
    }

    // If accessToken is provided, validate format
    if (accessToken && accessToken.length < 10) {
      return c.json(
        {
          success: false,
          error: "Access token too short",
        },
        400,
      )
    }

    return c.json({
      success: true,
      message: "Firela Vault configuration is valid",
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to test configuration",
      },
      500,
    )
  }
})

/**
 * POST /api/webhooks/test
 * Validates webhook configuration
 */
configRoutes.post("/webhooks/test", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      mode?: string
      publicUrl?: string
      healthCheckEnabled?: boolean
      healthCheckTimeout?: number
    }
    const { mode, publicUrl, healthCheckEnabled, healthCheckTimeout } = body

    // Validate connection mode
    const validModes = ["auto", "direct", "polling"]
    if (mode && !validModes.includes(mode)) {
      return c.json(
        {
          success: false,
          error: "Invalid connection mode",
        },
        400,
      )
    }

    // For direct mode, validate public URL is reachable
    if (mode === "direct") {
      if (!publicUrl) {
        return c.json(
          {
            success: false,
            error: "Public URL is required for direct mode",
          },
          400,
        )
      }

      // Validate URL format
      try {
        new URL(publicUrl)
      } catch {
        return c.json(
          {
            success: false,
            error: "Invalid public URL format",
          },
          400,
        )
      }

      // Try health check on public URL
      if (healthCheckEnabled) {
        try {
          const controller = new AbortController()
          const timeoutMs = healthCheckTimeout || 5000
          const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

          const response = await fetch(publicUrl, {
            method: "HEAD",
            signal: controller.signal,
          })

          clearTimeout(timeoutId)

          if (!response.ok) {
            return c.json(
              {
                success: false,
                error: `Public URL returned status ${response.status}`,
              },
              400,
            )
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : "Unknown error"
          return c.json(
            {
              success: false,
              error: `Failed to reach public URL: ${errorMsg}`,
            },
            400,
          )
        }
      }
    }

    return c.json({
      success: true,
      message: "Webhook configuration is valid",
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to test configuration",
      },
      500,
    )
  }
})

// ============================================================================
// Relay API Key Settings
// ============================================================================

const relayApiKeySchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
})

/**
 * GET /api/settings/relay
 *
 * Get current relay configuration (masked API key).
 */
configRoutes.get("/settings/relay", async (c) => {
  try {
    const apiKey = await getRelayApiKey(c.env)
    return c.json({
      success: true,
      data: {
        configured: !!apiKey,
        apiKeyMasked: apiKey ? maskApiKey(apiKey) : null,
        source: apiKey ? "kv" : null,
      },
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get relay settings",
      },
      500,
    )
  }
})

/**
 * PUT /api/settings/relay
 *
 * Save relay API key to KV storage.
 * This allows users to configure the relay API key via the UI
 * without needing Cloudflare Dashboard access.
 */
configRoutes.put(
  "/settings/relay",
  zValidator("json", relayApiKeySchema),
  async (c) => {
    try {
      const { apiKey } = c.req.valid("json")
      await c.env.CONFIG.put(RELAY_API_KEY_KEY, apiKey)
      return c.json({ success: true })
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save relay settings",
        },
        500,
      )
    }
  },
)

// ============================================================================
// Cloudflare API Token Settings
// ============================================================================

const cfApiTokenSchema = z.object({
  apiToken: z.string().min(1, "Cloudflare API token is required"),
})

/**
 * GET /api/settings/cloudflare
 *
 * Get current Cloudflare API token configuration (masked token).
 */
configRoutes.get("/settings/cloudflare", async (c) => {
  try {
    const cfToken = await getCloudflareApiToken(c.env)
    return c.json({
      success: true,
      data: {
        configured: !!cfToken,
        tokenMasked: cfToken ? maskApiKey(cfToken) : null,
        source: cfToken ? "kv" : null,
      },
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get Cloudflare settings",
      },
      500,
    )
  }
})

/**
 * PUT /api/settings/cloudflare
 *
 * Save Cloudflare API token to KV storage.
 * This allows users to configure the CF API token via the UI
 * without needing Cloudflare Dashboard or wrangler CLI access.
 */
configRoutes.put(
  "/settings/cloudflare",
  zValidator("json", cfApiTokenSchema),
  async (c) => {
    try {
      const { apiToken } = c.req.valid("json")
      await c.env.CONFIG.put(CF_API_TOKEN_KEY, apiToken)
      return c.json({ success: true })
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save Cloudflare settings",
        },
        500,
      )
    }
  },
)

// ============================================================================
// Password Settings
// ============================================================================

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(1, "New password is required"),
})

/**
 * PUT /api/settings/password
 *
 * Change the setup password. Requires JWT auth.
 * Rejects if password is managed via SETUP_PASSWORD env var.
 */
configRoutes.put(
  "/settings/password",
  zValidator("json", changePasswordSchema),
  async (c) => {
    try {
      const { currentPassword, newPassword } = c.req.valid("json")

      const storedPassword = await c.env.CONFIG.get(SETUP_PASSWORD_KEY) as string | null
      if (!storedPassword || currentPassword !== storedPassword) {
        return c.json(
          { success: false, error: "Current password is incorrect" },
          401,
        )
      }

      await c.env.CONFIG.put(SETUP_PASSWORD_KEY, newPassword)
      return c.json({ success: true })
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to change password",
        },
        500,
      )
    }
  },
)
