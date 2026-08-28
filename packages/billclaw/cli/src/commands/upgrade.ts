/**
 * Upgrade command
 *
 * Rebuild and redeploy the firela-bot Worker to Cloudflare with latest code.
 * For users who deployed via one-click Deploy Button or billclaw deploy.
 *
 * Steps: auth check -> build -> deploy
 */

import type { CliCommand, CliContext } from "./registry.js"
import { verifyCloudflareAuth, getMonorepoRoot } from "../utils/cloudflare.js"
import { deployUiWorker, runCommand } from "../utils/wrangler.js"
import { Spinner } from "../utils/progress.js"
import { success } from "../utils/format.js"

/**
 * Run the upgrade process
 *
 * 1. Verify Cloudflare authentication
 * 2. Build all packages
 * 3. Deploy the firela-bot Worker (reuses existing D1/KV by name)
 */
async function runUpgrade(_context: CliContext): Promise<void> {
  // Step 1: Verify authentication
  await Spinner.withLoading(
    "Verifying Cloudflare authentication...",
    verifyCloudflareAuth,
  )

  const monorepoRoot = getMonorepoRoot()

  // Step 2: Build all packages
  await Spinner.withLoading("Building all packages...", () =>
    runCommand("pnpm", ["build"], monorepoRoot),
  )

  // Step 3: Deploy the Worker
  const result = await Spinner.withLoading(
    "Deploying firela-bot Worker...",
    () => deployUiWorker({ temporary: false }),
  )

  // Success summary
  success("Upgrade complete!")
  success(`  - firela-bot Worker deployed: ${result.workerUrl}`)
}

/**
 * Upgrade command definition
 */
export const upgradeCommand: CliCommand = {
  name: "upgrade",
  description: "Rebuild and redeploy Workers to Cloudflare with latest code",
  handler: runUpgrade,
}
