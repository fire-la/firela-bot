/**
 * Deploy command
 *
 * Build and deploy the firela-bot Worker to Cloudflare.
 *
 * Two modes:
 * - Default: deploy to the authenticated Cloudflare account
 *   (wrangler login or CLOUDFLARE_API_TOKEN).
 * - --temporary: deploy to a throwaway temporary Cloudflare account —
 *   no signup needed. Prints a preview URL plus a claim URL that
 *   converts the deployment (and its data) into a permanent account.
 */

import type { CliCommand, CliContext } from "./registry.js"
import { getMonorepoRoot } from "../utils/cloudflare.js"
import { deployUiWorker, runCommand } from "../utils/wrangler.js"
import { Spinner } from "../utils/progress.js"
import { success, warn, info } from "../utils/format.js"

/**
 * Run the deploy process
 *
 * 1. Build all packages
 * 2. Provision D1/KV (create if missing) and deploy the UI Worker
 * 3. In temporary mode, print preview + claim URLs
 */
async function runDeploy(
  _context: CliContext,
  options?: Record<string, unknown>,
): Promise<void> {
  const temporary = options?.temporary === true

  if (temporary) {
    info(
      "Temporary mode: deploying to a throwaway Cloudflare account (no signup required)",
    )
  } else if (!process.env.CLOUDFLARE_API_TOKEN) {
    info(
      "No CLOUDFLARE_API_TOKEN detected — using whatever wrangler login state exists. " +
        "For a no-account trial instead, run: billclaw deploy --temporary",
    )
  }

  const monorepoRoot = getMonorepoRoot()

  await Spinner.withLoading("Building all packages...", () =>
    runCommand("pnpm", ["build"], monorepoRoot),
  )

  const result = await Spinner.withLoading(
    temporary
      ? "Provisioning resources and deploying to temporary account..."
      : "Provisioning resources and deploying firela-bot Worker...",
    () => deployUiWorker({ temporary }),
  )

  success(`Worker deployed: ${result.workerUrl}`)

  if (result.claimUrl) {
    warn(
      "This is a PREVIEW on a temporary Cloudflare account. All data (D1 + KV) is deleted if unclaimed.",
    )
    info(
      `Claim within ${result.claimMinutes ?? 60} minutes to keep the deployment permanently:`,
    )
    console.log(`  ${result.claimUrl}`)
    warn(
      "Keep this link private — anyone who opens it can claim the account.",
    )
    info(
      "Cron sync is disabled in preview mode. After claiming, run 'wrangler login' and " +
        "'billclaw deploy' to redeploy with scheduled sync enabled.",
    )
  }
}

/**
 * Deploy command definition
 */
export const deployCommand: CliCommand = {
  name: "deploy",
  description:
    "Build and deploy the firela-bot Worker to Cloudflare (use --temporary for a no-signup trial)",
  options: [
    {
      flags: "--temporary",
      description:
        "Deploy to a temporary Cloudflare account without signing up (claim within 60 minutes to keep it)",
    },
  ],
  handler: runDeploy,
}
