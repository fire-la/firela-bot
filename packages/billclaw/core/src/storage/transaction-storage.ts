/**
 * Local file storage utilities for BillClaw data
 */

import type { StorageConfig } from "../models/config.js"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

export interface Transaction {
  transactionId: string
  accountId: string
  date: string // ISO date string
  amount: number // Amount in cents (integer)
  currency: string
  category: string[]
  merchantName: string
  paymentChannel: string
  pending: boolean
  plaidTransactionId: string
  createdAt: string // ISO timestamp
  /** Provider's real account_id (Plaid txn.account_id / GoCardless gcAccount.id). Passed through to vlt for multi-account routing (ADR-0113 #17). Undefined for legacy/internal-only data. */
  externalAccountId?: string
}

/**
 * Sync state for idempotency
 */
export interface SyncState {
  syncId: string
  accountId: string
  startedAt: string
  completedAt?: string
  status: "running" | "completed" | "failed"
  transactionsAdded: number
  transactionsUpdated: number
  cursor: string
  error?: string
  requiresReauth?: boolean // Set to true when Plaid item requires re-authentication
}

/**
 * Account registry entry
 */
export interface AccountRegistry {
  id: string
  type: string
  name: string
  createdAt: string
  lastSync?: string
}

/**
 * Global cursor for incremental sync
 */
export interface GlobalCursor {
  lastSyncTime: string
}

/**
 * Get the base storage directory
 */
export async function getStorageDir(config?: StorageConfig): Promise<string> {
  const storagePath = config?.path || "~/.firela/billclaw"
  const expandedPath = storagePath.replace(/^~/, os.homedir())
  return expandedPath
}

/**
 * Initialize storage directory structure
 */
export async function initializeStorage(config?: StorageConfig): Promise<void> {
  const baseDir = await getStorageDir(config)

  const directories = [
    baseDir,
    path.join(baseDir, "accounts"),
    path.join(baseDir, "transactions"),
    path.join(baseDir, "sync"),
  ]

  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true })
    } catch {
      // Directory may already exist
    }
  }
}

/**
 * Read account registry
 */
export async function readAccountRegistry(
  config?: StorageConfig,
): Promise<AccountRegistry[]> {
  const baseDir = await getStorageDir(config)
  const filePath = path.join(baseDir, "accounts.json")

  try {
    const content = await fs.readFile(filePath, "utf-8")
    return JSON.parse(content)
  } catch {
    // File doesn't exist yet
    return []
  }
}

/**
 * Write account registry
 */
export async function writeAccountRegistry(
  accounts: AccountRegistry[],
  config?: StorageConfig,
): Promise<void> {
  const baseDir = await getStorageDir(config)
  const filePath = path.join(baseDir, "accounts.json")

  await initializeStorage(config)
  await fs.writeFile(filePath, JSON.stringify(accounts, null, 2), "utf-8")
}

/**
 * Read transactions for an account and month
 */
export async function readTransactions(
  accountId: string,
  year: number,
  month: number,
  config?: StorageConfig,
): Promise<Transaction[]> {
  const baseDir = await getStorageDir(config)
  const monthStr = month.toString().padStart(2, "0")
  const filePath = path.join(
    baseDir,
    "transactions",
    accountId,
    `${year}`,
    `${monthStr}.json`,
  )

  try {
    const content = await fs.readFile(filePath, "utf-8")
    return JSON.parse(content)
  } catch {
    return []
  }
}

/**
 * Write transactions for an account and month
 * Uses atomic write (temp file + rename) for safety
 */
export async function writeTransactions(
  accountId: string,
  year: number,
  month: number,
  transactions: Transaction[],
  config?: StorageConfig,
): Promise<void> {
  const baseDir = await getStorageDir(config)
  const monthStr = month.toString().padStart(2, "0")
  const dirPath = path.join(baseDir, "transactions", accountId, `${year}`)
  const filePath = path.join(dirPath, `${monthStr}.json`)

  await fs.mkdir(dirPath, { recursive: true })

  // Atomic write: write to temp file first, then rename
  const tempPath = filePath + ".tmp"
  await fs.writeFile(tempPath, JSON.stringify(transactions, null, 2), "utf-8")
  await fs.rename(tempPath, filePath)
}

/**
 * Append transactions to existing month file (with deduplication)
 */
export async function appendTransactions(
  accountId: string,
  year: number,
  month: number,
  newTransactions: Transaction[],
  config?: StorageConfig,
): Promise<{ added: number; updated: number }> {
  const existing = await readTransactions(accountId, year, month, config)
  const existingIds = new Set(existing.map((t) => t.transactionId))

  let added = 0
  let updated = 0

  for (const txn of newTransactions) {
    if (existingIds.has(txn.transactionId)) {
      // Update existing transaction
      const index = existing.findIndex(
        (t) => t.transactionId === txn.transactionId,
      )
      if (index !== -1) {
        existing[index] = txn
        updated++
      }
    } else {
      // Add new transaction
      existing.push(txn)
      existingIds.add(txn.transactionId)
      added++
    }
  }

  // Sort by date descending
  existing.sort((a, b) => b.date.localeCompare(a.date))

  await writeTransactions(accountId, year, month, existing, config)

  return { added, updated }
}

/**
 * Read sync state for an account
 */
export async function readSyncStates(
  accountId: string,
  config?: StorageConfig,
): Promise<SyncState[]> {
  const baseDir = await getStorageDir(config)
  const dirPath = path.join(baseDir, "sync", accountId)

  try {
    const files = await fs.readdir(dirPath)
    const states: SyncState[] = []

    for (const file of files) {
      if (!file.endsWith(".json")) continue
      const filePath = path.join(dirPath, file)
      const content = await fs.readFile(filePath, "utf-8")
      states.push(JSON.parse(content))
    }

    return states.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  } catch {
    return []
  }
}

/**
 * Write sync state
 */
export async function writeSyncState(
  state: SyncState,
  config?: StorageConfig,
): Promise<void> {
  const baseDir = await getStorageDir(config)
  const dirPath = path.join(baseDir, "sync", state.accountId)
  const filePath = path.join(dirPath, `${state.syncId}.json`)

  await fs.mkdir(dirPath, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8")
}

/**
 * Read global cursor
 */
export async function readGlobalCursor(
  config?: StorageConfig,
): Promise<GlobalCursor | null> {
  const baseDir = await getStorageDir(config)
  const filePath = path.join(baseDir, "cursor.json")

  try {
    const content = await fs.readFile(filePath, "utf-8")
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Write global cursor
 */
export async function writeGlobalCursor(
  cursor: GlobalCursor,
  config?: StorageConfig,
): Promise<void> {
  const baseDir = await getStorageDir(config)
  const filePath = path.join(baseDir, "cursor.json")

  await initializeStorage(config)
  await fs.writeFile(filePath, JSON.stringify(cursor, null, 2), "utf-8")
}

/**
 * Deduplicate transactions within a time window (24 hours)
 */
export function deduplicateTransactions(
  transactions: Transaction[],
  windowHours: number = 24,
): Transaction[] {
  const seen = new Set<string>()
  const now = new Date()
  const windowStartDate = new Date(now.getTime() - windowHours * 60 * 60 * 1000)
  const windowStartStr = windowStartDate.toISOString().split("T")[0]
  const result: Transaction[] = []

  // Sort by date ascending
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date))

  for (const txn of sorted) {
    const key = `${txn.accountId}_${txn.plaidTransactionId}`

    // Only include if not seen, or transaction date is within window (>= windowStartStr)
    if (!seen.has(key) || txn.date >= windowStartStr) {
      seen.add(key)
      result.push(txn)
    }
  }

  return result
}
