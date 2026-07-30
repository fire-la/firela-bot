/**
 * Plaid data source for BillClaw - Framework-agnostic Plaid integration
 */

import { Configuration, PlaidApi, PlaidEnvironments } from "plaid"
import type { TransactionsSyncRequest, TransactionsSyncResponse } from "plaid"
import type { StorageConfig, WebhookConfig } from "../../models/config.js"
import type {
  Transaction,
  SyncState,
} from "../../storage/transaction-storage.js"
import type { Logger, UserError } from "../../errors/errors.js"
import { parsePlaidError, ERROR_CODES } from "../../errors/errors.js"
import {
  appendTransactions,
  deduplicateTransactions,
  readSyncStates,
  writeGlobalCursor,
  writeSyncState,
} from "../../storage/transaction-storage.js"
import { emitEvent } from "../../services/event-emitter.js"

export interface PlaidConfig {
  clientId: string
  secret: string
  environment: "sandbox" | "development" | "production"
}

export interface PlaidAccount {
  id: string
  plaidAccessToken: string
}

export interface PlaidSyncResult {
  success: boolean
  accountId: string
  transactionsAdded: number
  transactionsUpdated: number
  cursor: string
  errors?: UserError[]
  requiresReauth?: boolean
}

/**
 * Create Plaid API client
 */
export function createPlaidClient(config: PlaidConfig): PlaidApi {
  const plaidEnvMap: Record<string, string> = {
    sandbox: PlaidEnvironments.sandbox,
    development: PlaidEnvironments.development,
    production: PlaidEnvironments.production,
  }

  const environment =
    plaidEnvMap[config.environment] || PlaidEnvironments.sandbox

  const configuration = new Configuration({
    basePath: environment,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": config.clientId,
        "PLAID-SECRET": config.secret,
      },
    },
  })

  return new PlaidApi(configuration)
}

/**
 * Convert Plaid transaction to internal format
 */
export function convertTransaction(
  plaidTxn: any,
  accountId: string,
  externalAccountId?: string,
): Transaction {
  return {
    transactionId: `${accountId}_${plaidTxn.transaction_id}`,
    accountId,
    date: plaidTxn.date,
    amount: Math.round(plaidTxn.amount * 100), // Convert to cents
    currency: plaidTxn.iso_currency_code,
    category: plaidTxn.category || [],
    merchantName: plaidTxn.merchant_name || plaidTxn.name || "Unknown",
    paymentChannel: plaidTxn.payment_channel,
    pending: plaidTxn.pending,
    plaidTransactionId: plaidTxn.transaction_id,
    createdAt: new Date().toISOString(),
    externalAccountId,
  }
}

/**
 * Retry Plaid API call with exponential backoff
 *
 * Retries on:
 * - 500 (Internal Server Error)
 * - 502 (Bad Gateway)
 * - 503 (Service Unavailable)
 * - 504 (Gateway Timeout)
 * - 429 (Rate Limit Exceeded)
 *
 * @param fn - Function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param logger - Logger for debug output
 * @returns Result of the function
 */
async function retryPlaidCall<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  logger?: Logger,
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      // Check if error is retryable
      const isRetryable =
        error &&
        typeof error === "object" &&
        "response" in error &&
        typeof (error as any).response?.status === "number"
          ? [500, 502, 503, 504, 429].includes(
              (error as any).response.status,
            )
          : false

      // Don't retry if not retryable or this is the last attempt
      if (!isRetryable || attempt === maxRetries) {
        throw error
      }

      // Calculate exponential backoff delay
      const baseDelay = 1000 // 1 second
      const maxDelay = 10000 // 10 seconds max
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)

      logger?.debug?.(
        `Plaid API call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`,
      )

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError || new Error("Retry failed")
}

/**
 * Sync transactions from a single Plaid account
 */
export async function syncPlaidAccount(
  account: PlaidAccount,
  plaidClient: PlaidApi,
  storageConfig: StorageConfig,
  logger: Logger,
  webhooks: WebhookConfig[] = [],
): Promise<PlaidSyncResult> {
  const errors: UserError[] = []
  let transactionsAdded = 0
  let transactionsUpdated = 0
  let cursor = ""
  let requiresReauth = false

  const syncId = `sync_${Date.now()}`
  const syncState: SyncState = {
    syncId,
    accountId: account.id,
    startedAt: new Date().toISOString(),
    status: "running",
    transactionsAdded: 0,
    transactionsUpdated: 0,
    cursor: "",
  }

  // Emit sync.started event (fire-and-forget)
  emitEvent(logger, webhooks, "sync.started", {
    accountId: account.id,
    syncId,
  }).catch((err) => logger.debug?.(`Event emission failed:`, err))

  try {
    // Get previous sync state for cursor
    const previousSyncs = await readSyncStates(account.id, storageConfig)
    const lastSync = previousSyncs.find((s) => s.status === "completed")
    const initialCursor = lastSync?.cursor || undefined

    // PAGINATION: Collect all transactions across all pages
    let currentCursor: string = initialCursor ?? ""
    let hasMore = true
    const allAdded: any[] = []
    const allModified: any[] = []
    const allRemoved: any[] = []

    while (hasMore) {
      const request: TransactionsSyncRequest = {
        access_token: account.plaidAccessToken,
        cursor: currentCursor,
        count: 500,
      }

      // Use retry logic for Plaid API call
      const axiosResponse = await retryPlaidCall(
        async () => await plaidClient.transactionsSync(request),
        3, // max 3 retries
        logger,
      )
      const response: TransactionsSyncResponse = axiosResponse.data

      // Collect transactions from this page
      allAdded.push(...(response.added || []))
      allModified.push(...(response.modified || []))
      allRemoved.push(...(response.removed || []))

      // Update cursor and has_more for next iteration
      currentCursor = response.next_cursor ?? ""
      hasMore = response.has_more ?? false

      logger.debug?.(
        `Plaid sync page for ${account.id}: ${allAdded.length} added, ${allModified.length} modified, ${allRemoved.length} removed, hasMore: ${hasMore}`,
      )
    }

    // CRITICAL: Only store cursor after ALL pages retrieved
    // If pagination fails mid-way, must restart from initialCursor
    cursor = currentCursor

    logger.info?.(
      `Plaid sync for ${account.id}: ${allAdded.length} added, ${allModified.length} modified, ${allRemoved.length} removed`,
    )

    // Convert both added AND modified transactions
    // Modified transactions are pending->posted transitions that need to be updated
    const transactions: Transaction[] = [
      ...allAdded.map((txn) => convertTransaction(txn, account.id, txn.account_id)),
      ...allModified.map((txn) => convertTransaction(txn, account.id, txn.account_id)),
    ]

    // Deduplicate transactions (24h window)
    const deduplicated = deduplicateTransactions(transactions, 24)

    // Group by month for storage
    const byMonth = new Map<string, Transaction[]>()
    for (const txn of deduplicated) {
      const date = new Date(txn.date)
      const key = `${date.getFullYear()}-${date.getMonth()}`
      if (!byMonth.has(key)) {
        byMonth.set(key, [])
      }
      byMonth.get(key)!.push(txn)
    }

    // Store transactions per month
    for (const [monthKey, monthTransactions] of byMonth.entries()) {
      const [year, month] = monthKey.split("-").map(Number)
      const result = await appendTransactions(
        account.id,
        year,
        month,
        monthTransactions,
        storageConfig,
      )
      transactionsAdded += result.added
      transactionsUpdated += result.updated
    }

    // Update sync state
    syncState.status = "completed"
    syncState.completedAt = new Date().toISOString()
    syncState.transactionsAdded = transactionsAdded
    syncState.transactionsUpdated = transactionsUpdated
    syncState.cursor = cursor

    logger.info?.(
      `Sync completed for ${account.id}: ${transactionsAdded} added, ${transactionsUpdated} updated`,
    )

    // Emit sync.completed event (fire-and-forget)
    const syncDuration = Date.now() - new Date(syncState.startedAt).getTime()
    emitEvent(logger, webhooks, "sync.completed", {
      accountId: account.id,
      syncId,
      transactionsAdded,
      transactionsUpdated,
      duration: syncDuration,
    }).catch((err) => logger.debug?.(`Event emission failed:`, err))
  } catch (error) {
    // Parse Plaid error to get UserError
    let userError: UserError
    if (error && typeof error === "object") {
      const plaidError = error as any
      userError = parsePlaidError(
        {
          error_code: plaidError.code || plaidError.error_code,
          error_message: plaidError.message || plaidError.error_message,
          error_type: plaidError.error_type,
          display_message: plaidError.display_message,
          request_id: plaidError.request_id,
          item_id: account.id,
        },
        account.id,
      )
    } else {
      // Generic error fallback
      userError = parsePlaidError(
        {
          error_message: error instanceof Error ? error.message : "Unknown error",
        },
        account.id,
      )
    }

    errors.push(userError)
    syncState.status = "failed"
    syncState.error = userError.humanReadable.message
    logger.error?.(`Sync failed for ${account.id}:`, error)

    // Emit sync.failed event (fire-and-forget)
    emitEvent(logger, webhooks, "sync.failed", {
      accountId: account.id,
      syncId,
      error: userError.humanReadable.message,
      errorCode: userError.errorCode,
    }).catch((err) => logger.debug?.(`Event emission failed:`, err))

    // Check for Plaid-specific errors that require user action
    if (userError.errorCode === ERROR_CODES.PLAID_ITEM_LOGIN_REQUIRED ||
        userError.errorCode === ERROR_CODES.PLAID_INVALID_ACCESS_TOKEN) {
      logger.warn?.(
        `Account ${account.id} requires re-authentication via Plaid Link`,
      )
      syncState.error = `ITEM_LOGIN_REQUIRED: Please re-connect this account via Plaid Link`
      syncState.requiresReauth = true
      requiresReauth = true
    }
  } finally {
    await writeSyncState(syncState, storageConfig)
  }

  return {
    success: errors.length === 0,
    accountId: account.id,
    transactionsAdded,
    transactionsUpdated,
    cursor,
    errors: errors.length > 0 ? errors : undefined,
    requiresReauth,
  }
}

/**
 * Sync multiple Plaid accounts
 */
export async function syncPlaidAccounts(
  accounts: PlaidAccount[],
  plaidConfig: PlaidConfig,
  storageConfig: StorageConfig,
  logger: Logger,
  webhooks: WebhookConfig[] = [],
): Promise<PlaidSyncResult[]> {
  if (accounts.length === 0) {
    return []
  }

  const plaidClient = createPlaidClient(plaidConfig)
  const results: PlaidSyncResult[] = []

  for (const account of accounts) {
    const result = await syncPlaidAccount(
      account,
      plaidClient,
      storageConfig,
      logger,
      webhooks,
    )
    results.push(result)
  }

  // Update global cursor
  await writeGlobalCursor(
    { lastSyncTime: new Date().toISOString() },
    storageConfig,
  )

  return results
}
