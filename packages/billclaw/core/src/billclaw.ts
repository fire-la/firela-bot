/**
 * BillClaw - Main class for financial data import
 *
 * This class provides the primary API for interacting with BillClaw.
 * It is framework-agnostic and can be used by any adapter (CLI, OpenClaw, etc.).
 */

import type { AccountConfig } from "./models/config.js"
import type { Logger, UserError } from "./errors/errors.js"
import type { RuntimeContext, ConfigProvider } from "./runtime/types.js"
import type { Transaction, SyncState } from "./storage/transaction-storage.js"
import type {
  PlaidSyncResult,
  PlaidAccount,
} from "./sources/plaid/plaid-sync.js"
import type {
  GmailFetchResult,
  GmailConfig,
  GmailAccount,
} from "./sources/gmail/gmail-fetch.js"
import type { SyncResult } from "./sync/sync-service.js"
import { createUserError, ERROR_CODES, ErrorCategory, parsePlaidError } from "./errors/errors.js"
import { emitEvent } from "./services/event-emitter.js"

// Storage
import {
  readTransactions,
  readSyncStates,
  initializeStorage,
  appendTransactions,
  deduplicateTransactions,
  writeSyncState,
  writeGlobalCursor,
} from "./storage/transaction-storage.js"

// Sync
import { syncDueAccounts } from "./sync/sync-service.js"

// Sources
import { convertTransaction } from "./sources/plaid/plaid-sync.js"
import { fetchGmailBills } from "./sources/gmail/gmail-fetch.js"
import { createPlaidAdapter } from "./sources/plaid/plaid-adapter.js"
import type { PlaidSyncAdapter } from "./sources/plaid/plaid-adapter.js"
import { createGoCardlessAdapter } from "./sources/gocardless/gocardless-adapter.js"
import { convertGoCardlessTransaction } from "./sources/gocardless/gocardless-sync.js"
import { ProviderError } from "./relay/errors.js"
import { parseGoCardlessRelayError, parsePlaidRelayError } from "./relay/index.js"
import { refreshGmailTokenViaRelay } from "./oauth/providers/gmail.js"

// Exporters
import {
  exportStorageToBeancount,
  exportStorageToLedger,
} from "./exporters/index.js"

/**
 * Check if an OAuth token is expired or about to expire
 *
 * @param expiryIso - Token expiry time as ISO string
 * @param bufferSeconds - Buffer time in seconds before expiry (default: 300 = 5 minutes)
 * @returns true if token is expired or will expire within buffer time
 */
export function isTokenExpired(
  expiryIso: string | undefined,
  bufferSeconds: number = 300,
): boolean {
  if (!expiryIso) {
    // No expiry time means token doesn't expire
    return false
  }

  const expiryTime = new Date(expiryIso).getTime()
  const now = Date.now()
  const bufferMs = bufferSeconds * 1000

  return now >= expiryTime - bufferMs
}

/**
 * BillClaw - Main class for financial data import
 */
export class Billclaw {
  private readonly context: RuntimeContext

  constructor(context: RuntimeContext) {
    this.context = context
  }

  /**
   * Get the logger
   */
  get logger(): Logger {
    return this.context.logger
  }

  /**
   * Get the config provider
   */
  get config(): ConfigProvider {
    return this.context.config
  }

  // ==================== Storage ====================

  /**
   * Initialize the storage directory structure
   */
  async initializeStorage(): Promise<void> {
    const storageConfig = await this.context.config.getStorageConfig()
    await initializeStorage(storageConfig)
    this.logger.info?.("Storage initialized")
  }

  /**
   * Get all registered accounts
   */
  async getAccounts(): Promise<any[]> {
    const config = await this.context.config.getConfig()
    return config.accounts || []
  }

  /**
   * Get transactions for an account and month
   */
  async getTransactions(
    accountId: string,
    year: number,
    month: number,
  ): Promise<Transaction[]> {
    const storageConfig = await this.context.config.getStorageConfig()
    return readTransactions(accountId, year, month, storageConfig)
  }

  /**
   * Get sync states for an account
   */
  async getSyncStates(accountId: string): Promise<SyncState[]> {
    const storageConfig = await this.context.config.getStorageConfig()
    return readSyncStates(accountId, storageConfig)
  }

  // ==================== Sync ====================

  /**
   * Sync provider interface - implemented by adapters
   */
  async syncAccount(accountId: string): Promise<SyncResult> {
    const config = await this.context.config.getConfig()
    const account = config.accounts.find((a) => a.id === accountId)

    if (!account) {
      const notFoundError: UserError = createUserError(
        ERROR_CODES.CONFIG_INVALID,
        ErrorCategory.CONFIG,
        "error",
        false,
        {
          title: "Account Not Found",
          message: `Account with ID "${accountId}" was not found in the configuration.`,
          suggestions: [
            "Verify the account ID is correct",
            "Check that the account exists in your configuration",
            "Run setup to add the account if needed",
          ],
        },
        [],
        { accountId },
      )
      return {
        accountId,
        success: false,
        transactionsAdded: 0,
        transactionsUpdated: 0,
        errors: [notFoundError],
      }
    }

    switch (account.type) {
      case "plaid":
        return await this.syncPlaidAccount(account)

      case "gocardless":
        return await this.syncGoCardlessAccount(account)

      case "gmail":
        return await this.syncGmailAccount(account)

      default:
        const unsupportedTypeError: UserError = createUserError(
          ERROR_CODES.CONFIG_INVALID,
          ErrorCategory.CONFIG,
          "error",
          false,
          {
            title: "Unsupported Account Type",
            message: `Account type "${account.type}" is not supported.`,
            suggestions: [
              "Supported account types are: plaid, gmail",
              "Update your configuration to use a supported account type",
            ],
          },
          [],
          { accountId },
        )
        return {
          accountId,
          success: false,
          transactionsAdded: 0,
          transactionsUpdated: 0,
          errors: [unsupportedTypeError],
        }
    }
  }

  /**
   * Sync all accounts that are due
   */
  async syncDueAccounts(): Promise<SyncResult[]> {
    const config = await this.context.config.getConfig()
    return syncDueAccounts(config.accounts, this, this.logger)
  }

  // ==================== Plaid ====================

  /**
   * Sync Plaid accounts using adapter factory for automatic mode selection.
   *
   * Supports both direct mode (user's own Plaid credentials) and relay mode
   * (via firela-relay service). Mode selection is automatic based on configuration.
   *
   * Fallback behavior: If relay mode fails and direct credentials exist,
   * will automatically fall back to direct mode.
   */
  async syncPlaid(accountIds?: string[]): Promise<PlaidSyncResult[]> {
    const config = await this.context.config.getConfig()
    const storageConfig = await this.context.config.getStorageConfig()

    // Filter accounts to sync
    const accounts: PlaidAccount[] = config.accounts
      .filter((a) => a.type === "plaid" && a.enabled && a.plaidAccessToken)
      .filter((a) => !accountIds || accountIds.includes(a.id))
      .map((a) => ({
        id: a.id,
        plaidAccessToken: a.plaidAccessToken!,
      }))

    if (accounts.length === 0) {
      this.logger.warn?.("No enabled Plaid accounts found")
      return []
    }

    // Create adapter using factory - this handles mode selection automatically
    let adapter: PlaidSyncAdapter
    try {
      adapter = await createPlaidAdapter(this.context)
    } catch (error) {
      // If relay mode failed but we have direct credentials, try fallback
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (errorMessage.includes("relay") && config.plaid?.clientId && config.plaid?.secret) {
        this.logger.warn?.("Relay unavailable, falling back to direct mode")
        const { DirectPlaidClient } = await import("./sources/plaid/plaid-adapter.js")
        adapter = new DirectPlaidClient(
          {
            clientId: config.plaid.clientId || process.env.PLAID_CLIENT_ID || "",
            secret: config.plaid.secret || process.env.PLAID_SECRET || "",
            environment: config.plaid.environment || "sandbox",
          },
          this.logger,
        )
      } else {
        // No fallback available - rethrow with actionable guidance
        throw error
      }
    }

    this.logger.info?.(`Syncing Plaid accounts using ${adapter.getMode()} mode`)

    // Sync each account using the adapter interface
    const results: PlaidSyncResult[] = []
    for (const account of accounts) {
      const result = await this.syncPlaidAccountWithAdapter(
        account,
        adapter,
        storageConfig,
        config.webhooks || [],
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

  /**
   * Sync a single Plaid account using the adapter interface.
   *
   * This internal method handles the cursor-based pagination and transaction
   * storage using the PlaidSyncAdapter interface.
   */
  private async syncPlaidAccountWithAdapter(
    account: PlaidAccount,
    adapter: PlaidSyncAdapter,
    storageConfig: any,
    webhooks: any[],
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

    // Emit sync.started event
    emitEvent(this.logger, webhooks, "sync.started", {
      accountId: account.id,
      syncId,
    }).catch((err) => this.logger.debug?.(`Event emission failed:`, err))

    try {
      // Get previous sync state for cursor
      const previousSyncs = await readSyncStates(account.id, storageConfig)
      const lastSync = previousSyncs.find((s) => s.status === "completed")
      const initialCursor = lastSync?.cursor || undefined

      // Pagination: Collect all transactions across all pages
      let currentCursor: string = initialCursor ?? ""
      let hasMore = true
      const allAdded: any[] = []
      const allModified: any[] = []
      const allRemoved: any[] = []

      while (hasMore) {
        const response = await adapter.syncTransactions(
          account.plaidAccessToken,
          currentCursor || undefined,
        )

        // Collect transactions from this page
        allAdded.push(...(response.added || []))
        allModified.push(...(response.modified || []))
        allRemoved.push(...(response.removed || []))

        // Update cursor and has_more for next iteration
        currentCursor = response.next_cursor ?? ""
        hasMore = response.has_more ?? false

        this.logger.debug?.(
          `Plaid sync page for ${account.id}: ${allAdded.length} added, ${allModified.length} modified, ${allRemoved.length} removed, hasMore: ${hasMore}`,
        )
      }

      // Store cursor after ALL pages retrieved
      cursor = currentCursor

      this.logger.info?.(
        `Plaid sync for ${account.id}: ${allAdded.length} added, ${allModified.length} modified, ${allRemoved.length} removed`,
      )

      // Convert both added AND modified transactions
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

      this.logger.info?.(
        `Sync completed for ${account.id}: ${transactionsAdded} added, ${transactionsUpdated} updated`,
      )

      // Emit sync.completed event
      const syncDuration = Date.now() - new Date(syncState.startedAt).getTime()
      emitEvent(this.logger, webhooks, "sync.completed", {
        accountId: account.id,
        syncId,
        transactionsAdded,
        transactionsUpdated,
        duration: syncDuration,
      }).catch((err) => this.logger.debug?.(`Event emission failed:`, err))
    } catch (error) {
      // Mode-aware error routing: relay vs direct
      let userError: UserError

      if (adapter.getMode() === "relay") {
        // Use relay-aware parser for relay mode
        userError = parsePlaidRelayError(error, { accountId: account.id })
      } else {
        // Keep existing direct-mode parser for direct mode
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
          userError = parsePlaidError(
            {
              error_message: error instanceof Error ? error.message : "Unknown error",
            },
            account.id,
          )
        }
      }

      errors.push(userError)
      syncState.status = "failed"
      syncState.error = userError.humanReadable.message
      this.logger.error?.(`Sync failed for ${account.id}:`, error)

      // Emit sync.failed event
      emitEvent(this.logger, webhooks, "sync.failed", {
        accountId: account.id,
        syncId,
        error: userError.humanReadable.message,
        errorCode: userError.errorCode,
      }).catch((err) => this.logger.debug?.(`Event emission failed:`, err))

      // Check for errors that require user re-authentication (both direct and relay codes)
      if (
        userError.errorCode === ERROR_CODES.PLAID_ITEM_LOGIN_REQUIRED ||
        userError.errorCode === ERROR_CODES.PLAID_INVALID_ACCESS_TOKEN ||
        userError.errorCode === ERROR_CODES.PLAID_RELAY_BANK_CONNECTION_EXPIRED
      ) {
        this.logger.warn?.(
          `Account ${account.id} requires re-authentication`,
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
   * Sync a single Plaid account
   */
  private async syncPlaidAccount(account: AccountConfig): Promise<SyncResult> {
    const results = await this.syncPlaid([account.id])
    const result = results[0]

    return {
      accountId: result.accountId,
      success: result.success,
      transactionsAdded: result.transactionsAdded,
      transactionsUpdated: result.transactionsUpdated,
      errors: result.errors,
    }
  }

  // ==================== Gmail ====================

  /**
   * Sync Gmail accounts
   */
  async syncGmail(
    accountIds?: string[],
    days: number = 30,
  ): Promise<GmailFetchResult[]> {
    const config = await this.context.config.getConfig()
    const storageConfig = await this.context.config.getStorageConfig()

    const gmailConfig: GmailConfig = config.gmail || {
      senderWhitelist: [],
      keywords: ["invoice", "statement", "bill due", "receipt", "payment due"],
      confidenceThreshold: 0.5,
      requireAmount: false,
      requireDate: false,
    }

    const accounts: GmailAccount[] = config.accounts
      .filter((a) => a.type === "gmail" && a.enabled)
      .filter((a) => !accountIds || accountIds.includes(a.id))
      .map((a) => ({
        id: a.id,
        gmailEmailAddress: a.gmailEmailAddress || "",
      }))

    if (accounts.length === 0) {
      this.logger.warn?.("No enabled Gmail accounts found")
      return []
    }

    const results: GmailFetchResult[] = []

    for (const account of accounts) {
      // Get access token from account config
      const accountConfig = config.accounts.find((a) => a.id === account.id)
      const accessToken = accountConfig?.gmailAccessToken
      const tokenExpiry = accountConfig?.gmailTokenExpiry

      if (!accessToken) {
        this.logger.warn?.(
          `No access token found for Gmail account ${account.id}. Please run OAuth setup first.`,
        )
        const noTokenError: UserError = createUserError(
          ERROR_CODES.GMAIL_AUTH_FAILED,
          ErrorCategory.GMAIL_AUTH,
          "error",
          true,
          {
            title: "No OAuth Access Token Found",
            message: `No OAuth access token was found for Gmail account ${account.id}.`,
            suggestions: [
              "Run OAuth setup first to authenticate with Gmail",
              "Ensure the account is properly configured",
            ],
          },
          [{ type: "oauth_reauth", tool: "gmail_oauth", params: { accountId: account.id } }],
          { accountId: account.id },
        )
        results.push({
          accountId: account.id,
          success: false,
          emailsProcessed: 0,
          billsExtracted: 0,
          transactionsAdded: 0,
          transactionsUpdated: 0,
          errors: [noTokenError],
        })
        continue
      }

      // Check if token is expired (with 5 minute buffer) and refresh via relay
      if (isTokenExpired(tokenExpiry, 300)) {
        try {
          const relayUrl = config.relay?.url
          if (!relayUrl) {
            throw new Error("relay.url required for Gmail token refresh")
          }

          // Get API key from relay config
          const apiKey = config.relay?.apiKey
          if (!apiKey) {
            throw new Error("relay.apiKey required for Gmail token refresh")
          }

          // Email comes from the initial connect flow:
          // retrieveGmailRelayCredential() -> email field -> saved to accountConfig.gmailEmailAddress
          // This email is the relay's storage key for looking up the stored refresh_token.
          const gmailEmail = accountConfig?.gmailEmailAddress
          if (!gmailEmail) {
            throw new Error(
              "gmailEmailAddress not configured -- run 'connect gmail' first to establish relay connection",
            )
          }

          const { accessToken: newAccessToken, expiresIn: newExpiresIn } =
            await refreshGmailTokenViaRelay(relayUrl, apiKey, gmailEmail)

          // Update stored token (no refresh_token stored locally)
          await this.context.config.updateAccount(account.id, {
            gmailAccessToken: newAccessToken,
            gmailTokenExpiry: new Date(Date.now() + newExpiresIn * 1000).toISOString(),
          })

          this.logger.info?.(
            `Gmail token refreshed via relay for account ${account.id}`,
          )
        } catch (refreshError) {
          const message = refreshError instanceof Error ? refreshError.message : String(refreshError)
          this.logger.error?.(`Gmail token refresh failed for ${account.id}: ${message}`)

          // Check for revoked authorization
          const isRevoked = message === "GMAIL_AUTH_REVOKED"

          const tokenExpiredError: UserError = createUserError(
            ERROR_CODES.GMAIL_AUTH_FAILED,
            ErrorCategory.GMAIL_AUTH,
            "error",
            true,
            {
              title: "Gmail Access Token Expired",
              message: isRevoked
                ? `Gmail authorization has been revoked for account ${account.id}. Please reconnect.`
                : `Failed to refresh Gmail token for account ${account.id}: ${message}`,
              suggestions: isRevoked
                ? [
                    "Gmail authorization was revoked by the user or Google",
                    "Run 'connect gmail' to re-authenticate",
                  ]
                : [
                    "Ensure connect.publicUrl and relay.apiKey are configured",
                    "Run 'connect gmail' to re-authenticate",
                  ],
            },
            [{ type: "oauth_reauth", tool: "gmail_oauth", params: { accountId: account.id } }],
            { accountId: account.id },
          )
          results.push({
            accountId: account.id,
            success: false,
            emailsProcessed: 0,
            billsExtracted: 0,
            transactionsAdded: 0,
            transactionsUpdated: 0,
            errors: [tokenExpiredError],
          })
          continue
        }
      }

      const result = await fetchGmailBills(
        account,
        days,
        gmailConfig,
        storageConfig,
        this.logger,
        accessToken,
      )
      results.push(result)
    }

    return results
  }

  /**
   * Sync a single Gmail account
   */
  private async syncGmailAccount(account: AccountConfig): Promise<SyncResult> {
    const results = await this.syncGmail([account.id])
    const result = results[0]

    return {
      accountId: result.accountId,
      success: result.success,
      transactionsAdded: result.transactionsAdded,
      transactionsUpdated: result.transactionsUpdated,
      errors: result.errors,
    }
  }

  // ==================== GoCardless ====================

  /**
   * Sync a single GoCardless account using relay adapter
   *
   * Uses createGoCardlessAdapter() factory for automatic relay mode selection.
   * GoCardless is RELAY ONLY - no direct mode available.
   */
  private async syncGoCardlessAccount(account: AccountConfig): Promise<SyncResult> {
    const storageConfig = await this.context.config.getStorageConfig()
    const errors: UserError[] = []
    let transactionsAdded = 0
    let transactionsUpdated = 0
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

    try {
      // Create adapter using factory
      const adapter = await createGoCardlessAdapter(this.context)
      this.logger.info?.(`Syncing GoCardless account ${account.id} using ${adapter.getMode()} mode`)

      // Get valid token with auto-refresh (replaces direct config read)
      let accessToken: string
      try {
        accessToken = await adapter.ensureValidToken(account.id)
      } catch (tokenError) {
        if (tokenError instanceof ProviderError && tokenError.code === "token_not_found") {
          const noTokenError: UserError = createUserError(
            ERROR_CODES.CONFIG_INVALID,
            ErrorCategory.CONFIG,
            "error",
            false,
            {
              title: "GoCardless Token Not Found",
              message: `No GoCardless token found in storage for account ${account.id}. The token may have been removed or the account needs to be re-connected.`,
              suggestions: [
                "Run the GoCardless connect command to re-authenticate",
                "Ensure the account completed the OAuth flow successfully",
              ],
            },
            [],
            { accountId: account.id },
          )
          errors.push(noTokenError)
          syncState.status = "failed"
          syncState.error = noTokenError.humanReadable.message
          await writeSyncState(syncState, storageConfig)
          return {
            accountId: account.id,
            success: false,
            transactionsAdded: 0,
            transactionsUpdated: 0,
            errors: [noTokenError],
          }
        }
        throw tokenError
      }

      // Get linked bank accounts
      const gcAccounts = await adapter.getAccounts(accessToken)

      // Fetch and convert transactions for each linked account
      const allTransactions: Transaction[] = []
      for (const gcAccount of gcAccounts) {
        const response = await adapter.getTransactions({
          access_token: accessToken,
          account_id: gcAccount.id,
        })

        // Convert booked transactions
        for (const txn of response.transactions.booked) {
          allTransactions.push(convertGoCardlessTransaction(txn, account.id, false, gcAccount.id))
        }

        // Convert pending transactions
        for (const txn of response.transactions.pending) {
          allTransactions.push(convertGoCardlessTransaction(txn, account.id, true, gcAccount.id))
        }
      }

      this.logger.info?.(
        `GoCardless sync for ${account.id}: ${allTransactions.length} total transactions from ${gcAccounts.length} accounts`,
      )

      // Deduplicate transactions
      const deduplicated = deduplicateTransactions(allTransactions, 24)

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

      this.logger.info?.(
        `Sync completed for ${account.id}: ${transactionsAdded} added, ${transactionsUpdated} updated`,
      )
    } catch (error) {
      const userError = parseGoCardlessRelayError(error, { accountId: account.id })

      errors.push(userError)
      syncState.status = "failed"
      syncState.error = userError.humanReadable.message
      this.logger.error?.(`GoCardless sync failed for ${account.id}:`, error)

      // Check for errors that require user re-authentication
      if (
        userError.errorCode === ERROR_CODES.GOCARDLESS_RELAY_TOKEN_EXPIRED ||
        userError.errorCode === ERROR_CODES.GOCARDLESS_RELAY_REQUISITION_NOT_FOUND
      ) {
        this.logger.warn?.(
          `Account ${account.id} requires re-authentication`,
        )
        syncState.requiresReauth = true
        requiresReauth = true
      }
    } finally {
      await writeSyncState(syncState, storageConfig)
    }

    return {
      accountId: account.id,
      success: errors.length === 0,
      transactionsAdded,
      transactionsUpdated,
      errors: errors.length > 0 ? errors : undefined,
      requiresReauth,
    }
  }

  // ==================== Exporters ====================

  /**
   * Export transactions to Beancount format
   */
  async exportToBeancount(
    accountId: string,
    year: number,
    month: number,
    options?: Partial<any>,
  ): Promise<string> {
    const storageConfig = await this.context.config.getStorageConfig()
    return exportStorageToBeancount(
      accountId,
      year,
      month,
      storageConfig,
      options,
    )
  }

  /**
   * Export transactions to Ledger format
   */
  async exportToLedger(
    accountId: string,
    year: number,
    month: number,
    options?: Partial<any>,
  ): Promise<string> {
    const storageConfig = await this.context.config.getStorageConfig()
    return exportStorageToLedger(accountId, year, month, storageConfig, options)
  }
}
