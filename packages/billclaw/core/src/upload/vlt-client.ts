/**
 * Firela VLT API client for BillClaw - Upload transactions to Firela VLT Beancount SaaS
 *
 * Provides HTTP client with retry logic for VLT Provider Sync API.
 * Uses native fetch with JWT Bearer token authentication.
 *
 * @packageDocumentation
 */

import type {
  AccountListResponseDto,
  AccountResponseDto,
  CreateExternalAccountLinkDto,
  ExternalAccountLinkListResponseDto,
  ExternalAccountLinkResponseDto,
} from "@firela/api-types"
import type { Logger } from "../errors/errors.js"
import type { VltRegion } from "../models/config.js"
import { calculateBackoffDelay } from "../utils/backoff.js"
import { parseVltError } from "../errors/errors.js"

/**
 * VLT API client configuration
 */
export interface VltClientConfig {
  /** VLT API base URL (e.g., http://localhost:3000/api/v1) */
  apiUrl: string
  /** JWT Bearer token for authentication */
  apiToken: string
  /** VLT region (cn, us, eu-core, de) */
  region: VltRegion
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
}

/**
 * Plaid-format transaction for VLT upload
 *
 * This format matches the VLT Provider Sync API expectations.
 * Amount is in dollars (NOT cents) - conversion happens in transform.ts.
 */
export interface PlaidTransactionUpload {
  transaction_id: string
  /** Amount in dollars (NOT cents) */
  amount: number
  iso_currency_code: string
  /** Date in YYYY-MM-DD format */
  date: string
  merchant_name?: string
  name: string
  pending: boolean
  account_id: string
  category?: string[]
  payment_channel?: string
}

/**
 * Provider sync configuration for VLT upload
 */
export interface ProviderSyncConfig {
  sourceAccount: string
  defaultCurrency: string
  /**
   * Optional — omit when no real default exists; the pipeline routes to Review
   * via the Uncategorized sentinel (vlt #618).
   */
  defaultExpenseAccount?: string
  /**
   * Optional — omit when no real default exists; the pipeline routes to Review
   * via the Uncategorized sentinel (vlt #618).
   */
  defaultIncomeAccount?: string
  filterPending?: boolean
  /**
   * External account ID for per-batch providers (ADR-0113 decision 4).
   *
   * Mirrors vlt's ProviderSyncConfig.externalAccountId for contract alignment.
   * billclaw currently uploads in Plaid per-tx format (account_id carried on
   * each transaction via transform.ts), so this field is reserved for future
   * per-batch providers and is not consumed on the current path.
   */
  externalAccountId?: string
}

/**
 * VLT upload result from Provider Sync API
 */
export interface VltUploadResult {
  /** Number of transactions successfully imported */
  imported: number
  /** Number of transactions skipped (duplicates) */
  skipped: number
  /** Number of transactions pending manual review */
  pendingReview: number
  /** Number of transactions that failed to import */
  failed: number
  /** IDs of successfully imported transactions */
  importedTransactionIds?: string[]
  /** IDs of transactions pending review */
  reviewItemIds?: string[]
}

/**
 * VLT API response for supported providers
 */
interface SupportedProvidersResponse {
  providers: string[]
}

/**
 * Retryable HTTP status codes
 */
const RETRYABLE_STATUS_CODES = [500, 502, 503, 504, 429]

/**
 * VLT API client with retry logic
 *
 * Provides methods to interact with VLT Provider Sync API:
 * - Upload transactions to VLT
 * - Check if a provider is supported
 *
 * Uses native fetch with JWT Bearer token authentication.
 * Implements retry logic with exponential backoff for transient errors.
 *
 * @example
 * ```typescript
 * const client = new VltClient({
 *   apiUrl: 'http://localhost:3000/api/v1',
 *   apiToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
 *   region: 'us',
 * }, logger)
 *
 * const result = await client.sync(transactions, syncConfig)
 * console.log(`Imported: ${result.imported}, Skipped: ${result.skipped}`)
 * ```
 */
export class VltClient {
  private readonly config: VltClientConfig
  private readonly logger?: Logger
  private readonly timeout: number

  constructor(config: VltClientConfig, logger?: Logger) {
    this.config = config
    this.logger = logger
    this.timeout = config.timeout ?? 30000
  }

  /**
   * Upload transactions to VLT via Provider Sync API
   *
   * @param transactions - Transactions in Plaid format
   * @param syncConfig - Provider sync configuration
   * @returns Upload result with counts
   * @throws UserError if upload fails after retries
   */
  async sync(
    transactions: PlaidTransactionUpload[],
    syncConfig: ProviderSyncConfig,
  ): Promise<VltUploadResult> {
    const endpoint = "/bean/import/provider/plaid/sync"

    const requestBody = {
      config: {
        sourceAccount: syncConfig.sourceAccount,
        defaultCurrency: syncConfig.defaultCurrency,
        defaultExpenseAccount: syncConfig.defaultExpenseAccount,
        defaultIncomeAccount: syncConfig.defaultIncomeAccount,
        filterPending: syncConfig.filterPending ?? true,
        // Forward per-batch external account id when provided (ADR-0113 #17).
        // billclaw currently uploads per-tx, so this is usually absent.
        ...(syncConfig.externalAccountId
          ? { externalAccountId: syncConfig.externalAccountId }
          : {}),
      },
      transactions,
    }

    this.logger?.info?.(
      `Uploading ${transactions.length} transactions to VLT (${this.config.region})...`,
    )

    const response = await this.requestWithRetry(endpoint, {
      method: "POST",
      body: JSON.stringify(requestBody),
    })

    const result = (await response.json()) as VltUploadResult

    this.logger?.info?.(
      `VLT upload complete: ${result.imported} imported, ${result.skipped} skipped, ${result.pendingReview} pending review, ${result.failed} failed`,
    )

    return result
  }

  /**
   * Check if Plaid provider is supported by VLT
   *
   * @returns true if provider is supported
   */
  async checkSupported(): Promise<boolean> {
    const endpoint = "/bean/import/provider/plaid/supported"

    try {
      const response = await this.requestWithRetry(endpoint, {
        method: "GET",
      })

      const result = (await response.json()) as SupportedProvidersResponse
      return result.providers?.includes("plaid") ?? false
    } catch (error) {
      this.logger?.warn?.("Failed to check VLT provider support:", error)
      return false
    }
  }

  /**
   * Make HTTP request with retry logic
   *
   * Retries on transient errors (5xx, 429) with exponential backoff.
   * Uses calculateBackoffDelay from utils module for Full Jitter algorithm.
   *
   * @param endpoint - API endpoint (without base URL)
   * @param options - Fetch options
   * @param maxRetries - Maximum retry attempts (default: 3)
   * @returns Response object
   * @throws UserError on final failure
   */
  private async requestWithRetry(
    endpoint: string,
    options: RequestInit,
    maxRetries: number = 3,
  ): Promise<Response> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.request(endpoint, options)

        // Check if response indicates a retryable error
        if (!response.ok && RETRYABLE_STATUS_CODES.includes(response.status)) {
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText}`)
        }

        // Return successful response or client error (don't retry client errors)
        return response
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check if we should retry
        const isRetryable = this.isRetryableError(lastError)

        // Don't retry if not retryable or this is the last attempt
        if (!isRetryable || attempt === maxRetries) {
          // Parse error and throw UserError
          throw parseVltError(lastError, {
            region: this.config.region,
            endpoint,
          })
        }

        // Calculate backoff delay using Full Jitter
        const baseDelay = 1000 // 1 second
        const maxDelay = 10000 // 10 seconds max
        const delay = Math.round(calculateBackoffDelay(baseDelay, maxDelay, attempt))

        this.logger?.debug?.(
          `VLT API call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`,
        )

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    // Should never reach here, but TypeScript needs it
    throw parseVltError(lastError || new Error("Unknown error"), {
      region: this.config.region,
      endpoint,
    })
  }

  /**
   * Make HTTP request to VLT API
   *
   * @param endpoint - API endpoint (without base URL)
   * @param options - Fetch options
   * @returns Response object
   */
  private async request(
    endpoint: string,
    options: RequestInit,
  ): Promise<Response> {
    const url = `${this.config.apiUrl}/${this.config.region}${endpoint}`

    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...options.headers,
        },
      })

      return response
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Assert a VLT response succeeded.
   *
   * requestWithRetry returns non-retryable 4xx responses instead of throwing,
   * so callers must check before parsing — otherwise an error body would be
   * cast to a success DTO.
   */
  private async assertOk(response: Response, action: string): Promise<void> {
    if (response.ok) return
    let detail = response.statusText
    try {
      detail = (await response.text()) || response.statusText
    } catch {
      // keep statusText
    }
    throw new Error(`VLT ${action} failed (${response.status}): ${detail}`)
  }

  /**
   * List the user's active external account links (ADR-0113 P1, issue #18).
   *
   * @param provider - Provider filter (whitelist value, e.g. "plaid")
   */
  async listExternalAccountLinks(
    provider: string,
  ): Promise<ExternalAccountLinkListResponseDto> {
    const response = await this.requestWithRetry(
      `/bean/external-account-links?provider=${encodeURIComponent(provider)}`,
      { method: "GET" },
    )
    await this.assertOk(response, "list external account links")
    return (await response.json()) as ExternalAccountLinkListResponseDto
  }

  /**
   * Create an external account → BeanAccount mapping (opaque ids only —
   * account names/masks/credentials never leave billclaw per ADR-0113).
   *
   * Remapping is DELETE then POST (vlt semantics; no replacedById chain).
   */
  async createExternalAccountLink(
    link: CreateExternalAccountLinkDto,
  ): Promise<ExternalAccountLinkResponseDto> {
    const response = await this.requestWithRetry(
      "/bean/external-account-links",
      { method: "POST", body: JSON.stringify(link) },
    )
    await this.assertOk(response, "create external account link")
    return (await response.json()) as ExternalAccountLinkResponseDto
  }

  /**
   * Soft-delete an external account link (isActive=false; history preserved).
   */
  async deleteExternalAccountLink(id: string): Promise<void> {
    const response = await this.requestWithRetry(
      `/bean/external-account-links/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    )
    // 204 No Content — no body to parse
    await this.assertOk(response, "delete external account link")
  }

  /**
   * List the user's BeanAccounts (mapping targets for the connect flow).
   *
   * Paginates at the schema max page size — the endpoint default (limit=100)
   * would silently truncate larger charts.
   */
  async listBeanAccounts(): Promise<AccountResponseDto[]> {
    const pageSize = 500
    const accounts: AccountResponseDto[] = []
    let offset = 0
    let total = Number.POSITIVE_INFINITY
    while (accounts.length < total) {
      const response = await this.requestWithRetry(
        `/bean/accounts?limit=${pageSize}&offset=${offset}`,
        { method: "GET" },
      )
      await this.assertOk(response, "list bean accounts")
      const page = (await response.json()) as AccountListResponseDto
      accounts.push(...page.items)
      total = page.total
      offset += pageSize
      // Guard against a server that ignores offset (prevents an infinite loop)
      if (page.items.length === 0) break
    }
    return accounts
  }

  /**
   * Check if an error should trigger a retry
   *
   * @param error - Error to check
   * @returns true if error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase()

    // Network errors
    if (
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("etimedout") ||
      message.includes("network") ||
      message.includes("abort") // Timeout
    ) {
      return true
    }

    // HTTP status errors
    if (message.includes("http 500") || message.includes("http 502") ||
        message.includes("http 503") || message.includes("http 504") ||
        message.includes("http 429")) {
      return true
    }

    return false
  }
}

/**
 * Upload transactions to VLT (convenience function)
 *
 * Creates an VltClient and uploads transactions in one call.
 *
 * @param config - VLT client configuration
 * @param transactions - Transactions to upload
 * @param syncConfig - Provider sync configuration
 * @param logger - Optional logger
 * @returns Upload result
 */
export async function uploadTransactions(
  config: VltClientConfig,
  transactions: PlaidTransactionUpload[],
  syncConfig: ProviderSyncConfig,
  logger?: Logger,
): Promise<VltUploadResult> {
  const client = new VltClient(config, logger)
  return client.sync(transactions, syncConfig)
}
