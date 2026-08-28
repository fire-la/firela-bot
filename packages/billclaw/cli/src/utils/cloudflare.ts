/**
 * Cloudflare utilities
 *
 * Shared utilities for Cloudflare Worker management:
 * auth verification, wrangler.toml parsing, and path resolution.
 */

import * as path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Cloudflare resources extracted from wrangler.toml
 */
export interface CloudflareResources {
  workerName: string
  d1DatabaseId: string
  d1DatabaseName: string
  kvNamespaceId: string
  kvBindingName: string
}

/**
 * Verify Cloudflare authentication
 *
 * Checks that CLOUDFLARE_API_TOKEN is set and valid by calling
 * the Cloudflare API token verify endpoint.
 *
 * @throws Error if token is missing or invalid
 */
export async function verifyCloudflareAuth(): Promise<{ status: string }> {
  const token = process.env.CLOUDFLARE_API_TOKEN

  if (!token) {
    throw new Error(
      "Cloudflare API token not found. Run 'wrangler login' or set CLOUDFLARE_API_TOKEN environment variable.",
    )
  }

  const response = await fetch(
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  )

  if (!response.ok) {
    const body = (await response.json()) as {
      errors?: Array<{ message: string }>
    }
    const errorMessage = body.errors?.[0]?.message ?? `HTTP ${response.status}`
    throw new Error(`Cloudflare authentication failed: ${errorMessage}`)
  }

  return (await response.json()) as { status: string }
}

/**
 * Parse wrangler.toml content to extract Cloudflare resources
 *
 * Uses simple regex parsing to extract worker name, D1 database, and KV namespace.
 *
 * @param tomlContent - Raw wrangler.toml file content
 * @returns Extracted Cloudflare resources
 * @throws Error if required fields are missing
 */
export function parseWranglerToml(tomlContent: string): CloudflareResources {
  // Extract worker name (first occurrence, top-level)
  const nameMatch = tomlContent.match(/^name\s*=\s*"([^"]+)"/m)
  if (!nameMatch) {
    throw new Error("Worker name not found in wrangler.toml")
  }
  const workerName = nameMatch[1]

  // Extract D1 database_id from [[d1_databases]] section
  const dbIdMatch = tomlContent.match(/database_id\s*=\s*"([^"]+)"/)
  if (!dbIdMatch) {
    throw new Error("D1 database_id not found in wrangler.toml")
  }
  const d1DatabaseId = dbIdMatch[1]

  // Extract database_name (optional)
  const dbNameMatch = tomlContent.match(/database_name\s*=\s*"([^"]+)"/)
  const d1DatabaseName = dbNameMatch?.[1] ?? ""

  // Extract KV namespace id from [[kv_namespaces]] section
  // We need to find the id field specifically in kv_namespaces context
  // Look for the pattern after [[kv_namespaces]]
  const kvSection = tomlContent.match(
    /\[\[kv_namespaces\]\]([\s\S]*?)(?=\[\[|$)/,
  )
  if (!kvSection) {
    throw new Error("KV namespace not found in wrangler.toml")
  }

  const kvIdMatch = kvSection[1].match(/id\s*=\s*"([^"]+)"/)
  if (!kvIdMatch) {
    throw new Error("KV namespace id not found in wrangler.toml")
  }
  const kvNamespaceId = kvIdMatch[1]

  // Extract KV binding (optional)
  const kvBindingMatch = kvSection[1].match(/binding\s*=\s*"([^"]+)"/)
  const kvBindingName = kvBindingMatch?.[1] ?? ""

  return {
    workerName,
    d1DatabaseId,
    d1DatabaseName,
    kvNamespaceId,
    kvBindingName,
  }
}

/**
 * Get absolute path to a monorepo package directory
 *
 * Resolves relative to the CLI package location following
 * the same pattern as ui.ts.
 *
 * @param packageName - Package directory name (e.g., "ui", "firela-bot")
 * @returns Absolute path to the package directory
 */
export function getPackagePath(packageName: string): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  // currentDir is packages/billclaw/cli/src/utils/
  // Go up 4 levels: utils/ -> src/ -> cli/ -> billclaw/ -> packages/
  // Then into the sibling package directory
  return path.resolve(currentDir, "..", "..", "..", "..", packageName)
}

/**
 * Get the monorepo root directory
 *
 * Resolves 5 levels up from this utils/ directory:
 * utils/ -> src/ -> cli/ -> billclaw/ -> packages/ -> monorepo root
 */
export function getMonorepoRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(currentDir, "..", "..", "..", "..", "..")
}
