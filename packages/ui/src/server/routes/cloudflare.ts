/**
 * Cloudflare Management API Routes
 *
 * REST endpoints for Cloudflare Worker self-upgrade and uninstall
 * from the billclaw UI. Users who deployed via one-click Deploy Button
 * can upgrade (pull latest code) or uninstall (remove all CF resources)
 * directly from the Settings page.
 *
 * @packageDocumentation
 */

import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"

import type { Env } from "../index.js"
import {
  verifyCloudflareAuth,
  getAccountId,
  getLatestRelease,
  downloadReleaseAsset,
  enumerateResources,
  deleteResources,
} from "../lib/cloudflare-api.js"
import { getCloudflareApiToken } from "../lib/cloudflare-helpers.js"

/**
 * Worker script name (matches wrangler.toml `name` field)
 */
const SCRIPT_NAME = "firela-bot"

/**
 * Schema for uninstall delete request body
 */
const deleteSchema = z.object({
  workers: z.array(z.string()).optional(),
  databases: z.array(z.string()).optional(),
  kvNamespaces: z.array(z.string()).optional(),
})

/**
 * Cloudflare management routes
 */
export const cloudflareRoutes = new Hono<{ Bindings: Env }>()

/**
 * POST /upgrade — Self-update the Worker
 *
 * Downloads latest Worker bundle from GitHub Release and updates
 * via CF API PUT .../content (preserves all bindings).
 */
cloudflareRoutes.post("/upgrade", async (c) => {
  const cfToken = await getCloudflareApiToken(c.env)
  const ghToken = c.env.GITHUB_TOKEN

  if (!cfToken) {
    return c.json(
      { success: false, error: "Cloudflare API token not configured" },
      400,
    )
  }

  // Verify CF auth
  const authed = await verifyCloudflareAuth(cfToken)
  if (!authed) {
    return c.json(
      { success: false, error: "Cloudflare authentication failed" },
      401,
    )
  }

  // Get account ID
  let accountId: string
  try {
    accountId = await getAccountId(cfToken)
  } catch (err) {
    return c.json(
      {
        success: false,
        error: `Failed to get Cloudflare account: ${(err as Error).message}`,
      },
      500,
    )
  }

  // Get latest release (ghToken is optional — anonymous access works for public repos)
  let release: { tagName: string; assets: Array<{ id: number; name: string }> }
  try {
    release = await getLatestRelease(ghToken)
  } catch (err) {
    return c.json(
      {
        success: false,
        error: `Failed to fetch latest release: ${(err as Error).message}`,
      },
      500,
    )
  }

  // Find Worker bundle asset
  const bundleAsset = release.assets.find(
    (a) => a.name === "firela-bot-worker.js" || a.name.endsWith("-worker.js"),
  )
  if (!bundleAsset) {
    return c.json(
      { success: false, error: "No worker bundle found in latest release" },
      500,
    )
  }

  // Download bundle (ghToken is optional)
  let bundleContent: string
  try {
    bundleContent = await downloadReleaseAsset(ghToken, bundleAsset.id)
  } catch (err) {
    return c.json(
      {
        success: false,
        error: `Failed to download worker bundle: ${(err as Error).message}`,
      },
      500,
    )
  }

  // Update Worker content via CF API (PUT .../content preserves bindings)
  const updateResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${SCRIPT_NAME}/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${cfToken}`,
        "Content-Type": "application/javascript",
      },
      body: bundleContent,
    },
  )

  if (!updateResponse.ok) {
    const errBody = (await updateResponse.json()) as {
      errors?: Array<{ message: string }>
    }
    return c.json(
      {
        success: false,
        error: `Failed to update worker: ${errBody.errors?.[0]?.message ?? `HTTP ${updateResponse.status}`}`,
      },
      500,
    )
  }

  return c.json({
    success: true,
    data: { version: release.tagName },
  })
})

/**
 * POST /uninstall/enumerate — List resources for confirmation dialog
 *
 * Enumerates all firela-related Workers, D1 databases, and KV namespaces.
 */
cloudflareRoutes.post("/uninstall/enumerate", async (c) => {
  const cfToken = await getCloudflareApiToken(c.env)
  if (!cfToken) {
    return c.json(
      { success: false, error: "Cloudflare API token not configured" },
      400,
    )
  }

  // Verify CF auth
  const authed = await verifyCloudflareAuth(cfToken)
  if (!authed) {
    return c.json(
      { success: false, error: "Cloudflare authentication failed" },
      401,
    )
  }

  // Get account ID
  let accountId: string
  try {
    accountId = await getAccountId(cfToken)
  } catch (err) {
    return c.json(
      {
        success: false,
        error: `Failed to get Cloudflare account: ${(err as Error).message}`,
      },
      500,
    )
  }

  // Enumerate resources
  try {
    const resources = await enumerateResources(cfToken, accountId)
    return c.json({ success: true, data: { accountId, resources } })
  } catch (err) {
    return c.json(
      {
        success: false,
        error: `Failed to enumerate resources: ${(err as Error).message}`,
      },
      500,
    )
  }
})

/**
 * POST /uninstall/delete — Delete confirmed resources
 *
 * Deletes specified resources with per-resource status reporting.
 * Sends response BEFORE deleting the Worker script itself so the UI
 * receives the result before going offline.
 */
cloudflareRoutes.post(
  "/uninstall/delete",
  zValidator("json", deleteSchema),
  async (c) => {
    const cfToken = await getCloudflareApiToken(c.env)
    if (!cfToken) {
      return c.json(
        { success: false, error: "Cloudflare API token not configured" },
        400,
      )
    }

    // Verify CF auth
    const authed = await verifyCloudflareAuth(cfToken)
    if (!authed) {
      return c.json(
        { success: false, error: "Cloudflare authentication failed" },
        401,
      )
    }

    // Get account ID
    let accountId: string
    try {
      accountId = await getAccountId(cfToken)
    } catch (err) {
      return c.json(
        {
          success: false,
          error: `Failed to get Cloudflare account: ${(err as Error).message}`,
        },
        500,
      )
    }

    const { workers, databases, kvNamespaces } = c.req.valid("json")

    // Delete non-Worker resources first, then Workers last
    // Workers are deleted last so the current request can complete
    // (CF Workers runtime keeps in-flight handlers running after script deletion)
    const nonWorkerResults = await deleteResources(cfToken, accountId, {
      databases,
      kvNamespaces,
    })

    // Now delete Workers (the serving Worker goes last)
    const workerResults = await deleteResources(cfToken, accountId, {
      workers,
    })

    const allResults = [...nonWorkerResults, ...workerResults]

    return c.json({
      success: true,
      data: { results: allResults },
    })
  },
)

/**
 * GET /version — Current and latest version info
 *
 * Returns current version (from APP_VERSION env or package.json)
 * and latest available version from GitHub Releases.
 */
cloudflareRoutes.get("/version", async (c) => {
  const currentVersion = c.env.APP_VERSION ?? "0.0.2"

  try {
    const release = await getLatestRelease(c.env.GITHUB_TOKEN)
    return c.json({
      success: true,
      data: { current: currentVersion, latest: release.tagName },
    })
  } catch {
    return c.json({
      success: true,
      data: { current: currentVersion, latest: null },
    })
  }
})
