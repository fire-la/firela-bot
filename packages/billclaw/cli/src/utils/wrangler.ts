/**
 * Wrangler deploy utilities
 *
 * Provisions D1/KV resources, generates a deploy-specific wrangler config,
 * and deploys the UI Worker — either to an authenticated Cloudflare account
 * or to a throwaway temporary account (claim-deployment preview).
 */

import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { getPackagePath, parseWranglerToml } from "./cloudflare.js"

/**
 * Minimum Node major version required by wrangler >= 4.102
 * (the first version supporting `--temporary` deployments).
 */
const REQUIRED_NODE_MAJOR = 22

/**
 * Result of a deployUiWorker run
 */
export interface DeployUiWorkerResult {
  workerUrl: string
  claimUrl?: string
  claimMinutes?: number
  configPath: string
}

/**
 * Options for deployUiWorker
 */
export interface DeployUiWorkerOptions {
  /** Deploy to a temporary Cloudflare account (no signup; returns claim URL). */
  temporary: boolean
}

/**
 * Resource ID overrides written into the generated wrangler config
 */
export interface DeployConfigOverrides {
  databaseId: string
  kvNamespaceId: string
  /** Remove cron schedules (temporary accounts have a 0-cron quota). */
  stripCrons: boolean
}

interface CommandOutput {
  code: number | null
  stdout: string
  stderr: string
}

/**
 * Local cache for resources whose discovery is unavailable in temporary mode
 * (`wrangler kv namespace list` does not accept --temporary, and a duplicate
 * `create` error does not include the existing namespace id).
 * Entries expire before the 60-minute claim window: an unclaimed temporary
 * account is deleted by Cloudflare, so a cached id would point at nothing.
 */
interface TempSessionCache {
  kvNamespaceId?: string
  createdAt: number
}

const TEMP_CACHE_TTL_MS = 50 * 60 * 1000

function tempSessionCachePath(): string {
  return path.join(
    os.homedir(),
    ".billclaw",
    "wrangler-temp-session-cache.json",
  )
}

/**
 * Read the temporary-session resource cache.
 */
export function readTempSessionCache(
  filePath: string = tempSessionCachePath(),
): TempSessionCache | null {
  try {
    const parsed = JSON.parse(
      readFileSync(filePath, "utf8"),
    ) as Partial<TempSessionCache>
    if (typeof parsed.createdAt === "number") {
      return parsed as TempSessionCache
    }
  } catch {
    // No readable cache yet — first run.
  }
  return null
}

/**
 * Whether a cache entry is still inside the claim window.
 */
export function isTempCacheFresh(
  cache: TempSessionCache,
  now: number = Date.now(),
): boolean {
  return now - cache.createdAt < TEMP_CACHE_TTL_MS
}

function writeTempSessionCache(
  cache: TempSessionCache,
  filePath: string = tempSessionCachePath(),
): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify(cache, null, 2))
  } catch {
    // Best-effort: without a cache, the next temporary deploy recreates the namespace.
  }
}

/**
 * Spawn a command and capture its combined output.
 * Resolves with the exit code instead of rejecting on failure,
 * so callers can decide which exit codes are acceptable.
 */
function captureCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: "pipe",
      shell: true,
    })

    let stdout = ""
    let stderr = ""
    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString()
    })
    proc.on("error", reject)
    proc.on("exit", (code) => resolve({ code, stdout, stderr }))
  })
}

/**
 * Run a command that must succeed (non-zero exit rejects with stderr).
 */
export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<CommandOutput> {
  const result = await captureCommand(command, args, cwd, env)
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(
      `Command "${command} ${args.join(" ")}" failed (exit ${result.code})${detail ? `: ${detail}` : ""}`,
    )
  }
  return result
}

/**
 * Throw early with a clear message when Node is too old for wrangler.
 */
function assertNodeVersion(): void {
  const major = Number(process.versions.node.split(".")[0])
  if (major < REQUIRED_NODE_MAJOR) {
    throw new Error(
      `Deploy requires Node.js >= ${REQUIRED_NODE_MAJOR} (wrangler requirement). Current: ${process.versions.node}. Use a newer Node version.`,
    )
  }
}

/**
 * Build the environment for wrangler invocations.
 *
 * Temporary mode isolates the wrangler config directory (XDG_CONFIG_HOME)
 * so the user's existing OAuth credentials are invisible and wrangler
 * provisions a fresh temporary account. A stable session directory under
 * ~/.billclaw lets repeated deploys reuse the same temporary account
 * within its claim window (wrangler renews it automatically once expired).
 */
function buildSessionEnv(temporary: boolean): NodeJS.ProcessEnv {
  if (!temporary) {
    return process.env
  }
  const sessionConfig = path.join(
    os.homedir(),
    ".billclaw",
    "wrangler-temp-session",
  )
  mkdirSync(sessionConfig, { recursive: true })
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.CLOUDFLARE_API_TOKEN
  delete env.CLOUDFLARE_ACCOUNT_ID
  env.XDG_CONFIG_HOME = sessionConfig
  return env
}

/**
 * Extract a JSON array from wrangler output that may contain
 * leading warnings or other non-JSON lines.
 */
function parseJsonArray(output: string): unknown[] {
  const start = output.indexOf("[")
  const end = output.lastIndexOf("]")
  if (start === -1 || end === -1 || end < start) {
    return []
  }
  try {
    const parsed = JSON.parse(output.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Find the UUID of a D1 database by name in `wrangler d1 list --json` output.
 */
export function findD1IdByName(listOutput: string, name: string): string | null {
  for (const entry of parseJsonArray(listOutput) as Array<
    Record<string, unknown>
  >) {
    if (entry.name === name) {
      const id = (entry.uuid ?? entry.id) as string | undefined
      if (id) {
        return id
      }
    }
  }
  return null
}

/**
 * Find the ID of a KV namespace by title in `wrangler kv namespace list --json` output.
 */
export function findKvIdByTitle(
  listOutput: string,
  title: string,
): string | null {
  for (const entry of parseJsonArray(listOutput) as Array<
    Record<string, unknown>
  >) {
    if (entry.title === title && typeof entry.id === "string") {
      return entry.id
    }
  }
  return null
}

/**
 * Parse the D1 database UUID from `wrangler d1 create` output.
 * Accepts both JSON snippets ("database_id": "...") and TOML snippets
 * (database_id = "...") — wrangler output style varies by version.
 */
export function parseD1IdFromCreate(output: string): string | null {
  return output.match(/"?database_id"?\s*[=:]\s*"([^"]+)"/)?.[1] ?? null
}

/**
 * Parse the KV namespace ID from `wrangler kv namespace create` output.
 * Accepts both JSON snippets ("id": "...") and TOML snippets (id = "...").
 */
export function parseKvIdFromCreate(output: string): string | null {
  return output.match(/\bid"?\s*[=:]\s*"([^"]+)"/)?.[1] ?? null
}

/**
 * Parse the deployed workers.dev URL from `wrangler deploy` output.
 */
export function parseWorkerUrl(output: string): string | null {
  return output.match(/^\s*(https:\/\/\S+\.workers\.dev)\s*$/m)?.[1] ?? null
}

/**
 * Parse the claim URL from `wrangler deploy --temporary` output.
 */
export function parseClaimUrl(output: string): string | null {
  return output.match(/Claim URL:\s*(\S+)/)?.[1] ?? null
}

/**
 * Parse the claim window (minutes) from `wrangler deploy --temporary` output.
 */
export function parseClaimMinutes(output: string): number | null {
  const value = output.match(/Claim within:\s*(\d+)\s*minutes/)?.[1]
  return value ? Number(value) : null
}

/**
 * Generate a deploy-specific wrangler config from the base wrangler.toml.
 *
 * Rewrites the D1 database_id and KV namespace id to freshly resolved
 * values, and optionally disables cron schedules (temporary accounts
 * have a 0-cron-trigger quota; deploy would fail the trigger step).
 */
export function generateDeployConfig(
  baseToml: string,
  overrides: DeployConfigOverrides,
): string {
  let config = baseToml.replace(
    /(database_id\s*=\s*)"[^"]*"/,
    `$1"${overrides.databaseId}"`,
  )
  config = config.replace(
    /(\[\[kv_namespaces\]\][\s\S]*?\bid\s*=\s*)"[^"]*"/,
    `$1"${overrides.kvNamespaceId}"`,
  )
  if (overrides.stripCrons) {
    config = config.replace(/crons\s*=\s*\[[^\]]*\]/, "crons = []")
  }
  const header =
    "# Generated by `billclaw deploy` — do not edit or commit.\n"
  return header + config
}

/**
 * Resolve (or create) the D1 database for deployment.
 * Reuses an existing database by name so repeat deploys are idempotent.
 */
async function resolveD1Id(
  run: (args: string[]) => Promise<CommandOutput>,
  databaseName: string,
): Promise<string> {
  const d1List = await run(["d1", "list", "--json"])
  const existingD1 = findD1IdByName(d1List.stdout + d1List.stderr, databaseName)
  if (existingD1) {
    return existingD1
  }
  const created = await run(["d1", "create", databaseName])
  const parsed = parseD1IdFromCreate(created.stdout + created.stderr)
  if (created.code !== 0 || !parsed) {
    throw new Error(
      `Failed to create D1 database "${databaseName}": ${created.stderr.trim() || created.stdout.trim()}`,
    )
  }
  return parsed
}

/**
 * Resolve (or create) the KV namespace for deployment.
 *
 * Normal mode lists namespaces and reuses one with a matching title.
 * Temporary mode cannot list (no --temporary support on that command),
 * so the created namespace id is cached locally for the claim window.
 */
async function resolveKvId(
  run: (args: string[]) => Promise<CommandOutput>,
  kvTitle: string,
  temporary: boolean,
): Promise<string> {
  if (temporary) {
    const cache = readTempSessionCache()
    if (cache?.kvNamespaceId && isTempCacheFresh(cache)) {
      return cache.kvNamespaceId
    }
    const created = await run(["kv", "namespace", "create", kvTitle])
    const parsed = parseKvIdFromCreate(created.stdout + created.stderr)
    if (created.code !== 0 || !parsed) {
      throw new Error(
        `Failed to create KV namespace "${kvTitle}": ${created.stderr.trim() || created.stdout.trim()}`,
      )
    }
    writeTempSessionCache({
      kvNamespaceId: parsed,
      createdAt: Date.now(),
    })
    return parsed
  }

  const kvList = await run(["kv", "namespace", "list", "--json"])
  const existingKv = findKvIdByTitle(kvList.stdout + kvList.stderr, kvTitle)
  if (existingKv) {
    return existingKv
  }
  const created = await run(["kv", "namespace", "create", kvTitle])
  const parsed = parseKvIdFromCreate(created.stdout + created.stderr)
  if (created.code !== 0 || !parsed) {
    throw new Error(
      `Failed to create KV namespace "${kvTitle}": ${created.stderr.trim() || created.stdout.trim()}`,
    )
  }
  return parsed
}

/**
 * Provision D1/KV resources, generate the deploy config, and deploy the UI Worker.
 *
 * Assumes the monorepo has already been built (`pnpm build` at the root):
 * wrangler bundles src/server/index.ts itself, but the static assets in
 * dist/ come from the Vite build.
 */
export async function deployUiWorker(
  options: DeployUiWorkerOptions,
): Promise<DeployUiWorkerResult> {
  assertNodeVersion()

  const uiPath = getPackagePath("ui")
  const baseConfigPath = path.join(uiPath, "wrangler.toml")
  const baseConfig = readFileSync(baseConfigPath, "utf8")
  const resources = parseWranglerToml(baseConfig)

  const env = buildSessionEnv(options.temporary)
  const tempFlag = options.temporary ? ["--temporary"] : []
  const run = (args: string[]) =>
    captureCommand(
      "pnpm",
      ["exec", "wrangler", ...args, ...tempFlag],
      uiPath,
      env,
    )

  const databaseId = await resolveD1Id(run, resources.d1DatabaseName)
  const kvNamespaceId = await resolveKvId(
    run,
    resources.kvBindingName,
    options.temporary,
  )

  const configContent = generateDeployConfig(baseConfig, {
    databaseId,
    kvNamespaceId,
    stripCrons: options.temporary,
  })
  const configFileName = "wrangler.deploy.toml"
  const configPath = path.join(uiPath, configFileName)
  writeFileSync(configPath, configContent)

  const deployed = await run(["deploy", "-c", configFileName])
  if (deployed.code !== 0) {
    throw new Error(
      `wrangler deploy failed: ${deployed.stderr.trim() || deployed.stdout.trim()}`,
    )
  }

  const output = deployed.stdout + deployed.stderr
  const workerUrl = parseWorkerUrl(output)
  if (!workerUrl) {
    throw new Error(
      `Could not find the deployed Worker URL in wrangler output:\n${output}`,
    )
  }

  return {
    workerUrl,
    claimUrl: parseClaimUrl(output) ?? undefined,
    claimMinutes: parseClaimMinutes(output) ?? undefined,
    configPath,
  }
}
