/**
 * Scheduled Plaid → VLT sync job for the ui Worker.
 *
 * Worker-native fetch → VLT pipeline (ADR-009 Decision A, Option B). Does NOT use
 * the `Billclaw` class (its persistence is filesystem-bound). Instead it reuses
 * core's pure pieces: `RelayPlaidClient.syncTransactions` (in-memory) →
 * `toPlaidUpload` → `uploadTransactions`. Only the per-account cursor is persisted
 * (KV); VLT is the ledger / system of record.
 *
 * Triggered by the Worker `scheduled()` handler (cron) and by `POST /api/sync/run`.
 *
 * @packageDocumentation
 */

import {
  uploadTransactions,
  type VltClientConfig,
  type ProviderSyncConfig,
  type VltRegion,
} from "@firela/billclaw-core"

import type { Env } from "../index.js"
import { getPlaidRelayClient } from "../lib/plaid-relay.js"
import { getVltJwt } from "../lib/vlt-auth.js"
import { toPlaidUpload, type RawPlaidTransaction } from "./plaid-upload-converter.js"

// ---------------------------------------------------------------------------
// KV keys
// ---------------------------------------------------------------------------

const CONFIG_KEY = "billclaw:config"
const ACCOUNTS_KEY = "billclaw:accounts"
const cursorKey = (id: string): string => `billclaw:cursor:${id}`
const lockKey = (id: string): string => `sync_lock_${id}`

/** KV lock TTL (seconds) — bounds how long a crashed/overlapping run blocks. */
const LOCK_TTL_SECONDS = 900

/** Per-cycle pagination safety cap; the cursor lets the next cron resume. */
const MAX_PAGES = 50

// ---------------------------------------------------------------------------
// Local config shapes (the stored `billclaw:config` JSON)
// ---------------------------------------------------------------------------

interface VltUploadConfig {
  mode?: string
  sourceAccount: string
  defaultCurrency?: string
  defaultExpenseAccount?: string
  defaultIncomeAccount?: string
  filterPending?: boolean
}

interface StoredConfig {
  vlt?: {
    apiUrl: string
    accessToken?: string
    region?: VltRegion
    upload?: VltUploadConfig
  }
}

interface SyncAccount {
  id: string
  name?: string
  provider?: string
  type?: string
  plaidAccessToken?: string
  enabled?: boolean
  status?: string
  lastSync?: string
  lastStatus?: string
}

type AccountSyncOutcome =
  | { id: string; status: "ok" }
  | { id: string; status: "error"; error: string }
  | { id: string; status: "skipped" }

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Sync all enabled Plaid accounts due for sync.
 *
 * - No-op when VLT is not configured or `vlt.upload.mode !== "auto"`.
 * - No-op when there are no enabled, connected Plaid accounts with a stored token.
 * - One VLT JWT is obtained per run (cached in KV via {@link getVltJwt}).
 * - Per account: a best-effort KV lock guards against overlapping runs; the cursor
 *   advances ONLY on a successful upload; the lock is ALWAYS released.
 */
export async function runSyncJob(env: Env): Promise<void> {
  const config = await env.CONFIG.get<StoredConfig>(CONFIG_KEY, "json")
  const vlt = config?.vlt
  const upload = vlt?.upload

  // Gate: VLT not configured, or auto-sync not enabled.
  if (!vlt?.accessToken || !upload || upload.mode !== "auto") {
    console.log("[sync-job] Skipping: VLT auto-sync not configured")
    return
  }

  const accounts = (await env.CONFIG.get<SyncAccount[]>(ACCOUNTS_KEY, "json")) ?? []
  const due = accounts.filter(
    (a) =>
      (a.provider === "plaid" || a.type === "plaid") &&
      !!a.plaidAccessToken &&
      a.enabled !== false &&
      a.status === "connected",
  )
  if (due.length === 0) {
    console.log("[sync-job] No enabled Plaid accounts to sync")
    return
  }

  const jwt = await getVltJwt(env, {
    apiUrl: vlt.apiUrl,
    accessToken: vlt.accessToken,
    region: (vlt.region ?? "us") as VltRegion,
  })

  const vltConfig: VltClientConfig = {
    apiUrl: vlt.apiUrl,
    apiToken: jwt,
    region: (vlt.region ?? "us") as VltRegion,
  }

  const providerSyncConfig: ProviderSyncConfig = {
    sourceAccount: upload.sourceAccount,
    defaultCurrency: upload.defaultCurrency ?? "USD",
    defaultExpenseAccount: upload.defaultExpenseAccount ?? "Expenses:Unknown",
    defaultIncomeAccount: upload.defaultIncomeAccount ?? "Income:Unknown",
    filterPending: upload.filterPending ?? true,
  }

  const client = await getPlaidRelayClient(env)

  const outcomes = await Promise.all(
    due.map((account) =>
      syncOneAccount(client, account, vltConfig, providerSyncConfig, env).catch(
        (err): AccountSyncOutcome => ({
          id: account.id,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    ),
  )

  await mergeOutcomesIntoAccounts(env, outcomes)
}

// ---------------------------------------------------------------------------
// Per-account sync
// ---------------------------------------------------------------------------

async function syncOneAccount(
  client: Awaited<ReturnType<typeof getPlaidRelayClient>>,
  account: SyncAccount,
  vltConfig: VltClientConfig,
  providerSyncConfig: ProviderSyncConfig,
  env: Env,
): Promise<AccountSyncOutcome> {
  // Best-effort KV lock (get-then-put; KV is eventually consistent — documented
  // acceptable trade-off given idempotent VLT upload + 6h cadence).
  if ((await env.CONFIG.get(lockKey(account.id))) != null) {
    console.log(`[sync-job] ${account.id}: lock held, skipping`)
    return { id: account.id, status: "skipped" }
  }
  await env.CONFIG.put(lockKey(account.id), JSON.stringify({ at: nowIso() }), {
    expirationTtl: LOCK_TTL_SECONDS,
  })

  try {
    let cursor = (await env.CONFIG.get(cursorKey(account.id))) ?? undefined
    const collected: RawPlaidTransaction[] = []
    let nextCursor = cursor ?? ""
    let pages = 0

    while (pages < MAX_PAGES) {
      const res = await client.syncTransactions(account.plaidAccessToken!, cursor)
      // Append-only sync (ADR-009): `removed` txns are intentionally ignored —
      // VLT is the ledger and dedupes by transaction_id; deletion propagation is
      // out of scope (no VLT delete API wired here).
      collected.push(...((res.added ?? []) as RawPlaidTransaction[]))
      collected.push(...((res.modified ?? []) as RawPlaidTransaction[]))
      nextCursor = res.next_cursor ?? nextCursor
      pages += 1
      if (!res.has_more) break
      cursor = res.next_cursor ?? cursor
    }

    const txns = providerSyncConfig.filterPending
      ? collected.filter((t) => !t.pending)
      : collected

    const uploadTxns = txns.map((t) => toPlaidUpload(t, account.id))

    // Skip the VLT round-trip when there is nothing to upload (steady-state).
    // When there IS data, uploadTransactions throwing aborts before the cursor
    // put below — so the cursor advances only on success (or a no-op).
    if (uploadTxns.length > 0) {
      await uploadTransactions(vltConfig, uploadTxns, providerSyncConfig, console)
    }

    await env.CONFIG.put(cursorKey(account.id), nextCursor)

    console.log(
      `[sync-job] ${account.id}: uploaded ${uploadTxns.length} txn(s), cursor=${nextCursor}`,
    )
    return { id: account.id, status: "ok" }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[sync-job] ${account.id}: ${error}`)
    return { id: account.id, status: "error", error }
  } finally {
    await env.CONFIG.delete(lockKey(account.id))
  }
}

// ---------------------------------------------------------------------------
// Status merge
// ---------------------------------------------------------------------------

async function mergeOutcomesIntoAccounts(
  env: Env,
  outcomes: AccountSyncOutcome[],
): Promise<void> {
  const touched = outcomes.filter((o) => o.status === "ok" || o.status === "error")
  if (touched.length === 0) return

  const stamp = nowIso()
  const accounts =
    (await env.CONFIG.get<SyncAccount[]>(ACCOUNTS_KEY, "json")) ?? []

  for (const outcome of touched) {
    const idx = accounts.findIndex((a) => a.id === outcome.id)
    if (idx === -1) continue
    accounts[idx] = {
      ...accounts[idx],
      lastSync: stamp,
      lastStatus: outcome.status === "ok" ? "ok" : "error",
    }
  }

  await env.CONFIG.put(ACCOUNTS_KEY, JSON.stringify(accounts))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString()
}
