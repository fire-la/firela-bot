/**
 * Upgrade command
 *
 * Rebuild and redeploy Workers to Cloudflare with latest code.
 * For users who deployed via one-click Deploy Button.
 *
 * Steps: auth check -> build -> deploy UI -> deploy bot
 */

import type { CliCommand, CliContext } from "./registry.js"
import { spawn } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { verifyCloudflareAuth, getPackagePath } from "../utils/cloudflare.js"
import { Spinner } from "../utils/progress.js"
import { success } from "../utils/format.js"

/**
 * Spawn a command and return a promise that resolves on success or rejects on failure
 *
 * @param command - Command to run
 * @param args - Arguments
 * @param cwd - Working directory
 */
function spawnCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: "pipe",
      shell: true,
    })

    let stderr = ""

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on("exit", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Command "${command} ${args.join(" ")}" failed (exit ${code})${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        )
      } else {
        resolve()
      }
    })

    proc.on("error", (err) => {
      reject(err)
    })
  })
}

/**
 * Get monorepo root directory
 *
 * Resolves 5 levels up from commands/ directory:
 * commands/ -> src/ -> cli/ -> billclaw/ -> packages/ -> monorepo root
 */
function getMonorepoRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(currentDir, "..", "..", "..", "..", "..")
}

/**
 * Run the upgrade process
 *
 * 1. Verify Cloudflare authentication
 * 2. Build all packages
 * 3. Deploy UI Worker
 * 4. Deploy Bot Worker
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
    spawnCommand("pnpm", ["build"], monorepoRoot),
  )

  // Step 3: Deploy UI Worker
  const uiPath = getPackagePath("ui")
  await Spinner.withLoading("Deploying firela-bot Worker (UI)...", () =>
    spawnCommand("pnpm", ["run", "deploy"], uiPath),
  )

  // Step 4: Deploy Bot Worker
  const botPath = getPackagePath("firela-bot")
  await Spinner.withLoading("Deploying firela-bot Worker (Discord)...", () =>
    spawnCommand("pnpm", ["run", "deploy"], botPath),
  )

  // Success summary
  success("Upgrade complete!")
  success("  - firela-bot Worker (UI) deployed")
  success("  - firela-bot Worker (Discord) deployed")
}

/**
 * Upgrade command definition
 */
export const upgradeCommand: CliCommand = {
  name: "upgrade",
  description: "Rebuild and redeploy Workers to Cloudflare with latest code",
  handler: runUpgrade,
}
