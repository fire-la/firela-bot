/**
 * Sync Status API Routes
 *
 * REST endpoints for sync status.
 * Returns sync status for all connected accounts.
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import type { Env } from "../index.js"
import { runSyncJob } from "../jobs/sync-job.js"

export const syncRoutes = new Hono<{ Bindings: Env }>()

// KV key for accounts storage
const ACCOUNTS_KEY = "billclaw:accounts"

/**
 * GET /api/sync/status
 * Returns sync status for all connected accounts
 */
syncRoutes.get("/status", async (c) => {
  try {
    // Check if CONFIG KV namespace is available
    if (!c.env.CONFIG) {
      return c.json({
        success: true,
        data: {
          lastSync: null,
          status: "idle",
          accounts: [],
        },
        message: "KV storage not configured",
      })
    }

    // Get accounts from KV storage
    const accounts = await c.env.CONFIG.get(ACCOUNTS_KEY, "json")

    // Handle no accounts case
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return c.json({
        success: true,
        data: {
          lastSync: null,
          status: "idle",
          accounts: [],
        },
      })
    }

    // Transform accounts for UI display
    const accountList = accounts as Record<string, unknown>[]
    const transformedAccounts = accountList.map((account) => ({
      id: account.id as string,
      name: account.name as string,
      lastSync: (account.lastSync as string) || null,
    }))

    // Determine overall sync status
    // Since we're in Cloudflare Workers, we don't have real-time sync state
    // Status is based on lastSync timestamp
    let overallStatus: "idle" | "syncing" | "error" = "idle"
    let lastSync: string | null = null

    // Find the most recent sync time across all accounts
    for (const account of accountList) {
      if (account.lastSync) {
        const accountLastSync = account.lastSync as string
        if (!lastSync || new Date(accountLastSync) > new Date(lastSync)) {
          lastSync = accountLastSync
        }
      }
      // Check for error status
      if (account.lastStatus === "error") {
        overallStatus = "error"
      }
    }

    return c.json({
      success: true,
      data: {
        lastSync,
        status: overallStatus,
        accounts: transformedAccounts,
      },
    })
  } catch (error) {
    return c.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get sync status",
      },
      500,
    )
  }
})

/**
 * POST /api/sync/run
 *
 * Trigger a manual Plaid -> VLT sync (fire-and-forget). Same pipeline as the
 * scheduled cron run (runSyncJob). Status is observable via GET /api/sync/status.
 *
 * Response:
 * - success: boolean
 * - message: string
 */
syncRoutes.post("/run", async (c) => {
  const ctx = c.executionCtx
  if (ctx) {
    ctx.waitUntil(runSyncJob(c.env))
  } else {
    // No execution context (not a Workers fetch) — run inline.
    await runSyncJob(c.env)
  }
  return c.json({ success: true, message: "sync started" })
})
