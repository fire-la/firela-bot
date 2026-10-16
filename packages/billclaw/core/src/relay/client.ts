/**
 * Relay client for BillClaw - HTTP communication with firela-relay service
 *
 * Provides HTTP client with retry logic for firela-relay API.
 * Uses native fetch with Bearer token authentication.
 *
 * SECURITY: All tokens (access_token, refresh_token) are:
 * - Passed in request body (never in URL parameters)
 * - Redacted from all log output via redactSensitive()
 * - Stored locally only (never sent to relay for storage)
 *
 * @packageDocumentation
 */

import type { Logger } from "../errors/errors.js"
import { calculateBackoffDelay } from "../utils/backoff.js"
import { parseRelayError } from "./errors.js"
import { redactSensitive } from "./redact.js"
import type {
  RelayClientConfig,
  RelayHealthCheckResponse,
  RelayHealthCheckResult,
  WebhookCallbackRegistration,
} from "./types.js"

/**
 * Retryable HTTP status codes
 */
const RETRYABLE_STATUS_CODES = [500, 502, 503, 504, 429]

/**
 * Default health check timeout in milliseconds
 */
const DEFAULT_HEALTH_CHECK_TIMEOUT = 5000

/**
 * Relay API client with retry logic
 *
 * Provides methods to interact with firela-relay API:
 * - Make authenticated requests with Bearer token
 * - Health check for relay availability
 *
 * Uses native fetch with Bearer token authentication.
 * Implements retry logic with exponential backoff for transient errors.
 *
 * @example
 * ```typescript
 * const client = new RelayClient({
 *   url: 'https://relay.firela.io',
 *   apiKey: 'your-api-key',
 * }, logger)
 *
 * const result = await client.request('/v1/accounts', { method: 'GET' })
 * console.log(result)
 *
 * const health = await client.healthCheck()
 * console.log('Relay available:', health.available)
 * ```
 */
export class RelayClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeout: number
  private readonly maxRetries: number
  private readonly logger?: Logger

  constructor(config: RelayClientConfig, logger?: Logger) {
    // Validate URL scheme (HTTPS required for production)
    const url = config.url.toLowerCase()
    const isLocalhost =
      url.includes("localhost") || url.includes("127.0.0.1")
    if (!url.startsWith("https://") && !isLocalhost) {
      throw new Error(
        "Relay URL must use HTTPS. HTTP is only allowed for localhost development.",
      )
    }

    // Normalize base URL (remove trailing slash)
    this.baseUrl = config.url.replace(/\/$/, "")
    this.apiKey = config.apiKey
    this.timeout = config.timeout ?? 30000
    this.maxRetries = config.maxRetries ?? 3
    this.logger = logger
  }

  /**
   * Make HTTP request to relay API
   *
   * @param endpoint - API endpoint (without base URL)
   * @param options - Fetch options
   * @returns Parsed JSON response
   * @throws RelayHttpError | RelayError | ProviderError on failure
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    let lastError: Error | undefined

    // Log request with redacted sensitive data
    if (options.body && typeof options.body === "string") {
      try {
        const bodyData = JSON.parse(options.body)
        this.logger?.debug?.(
          `Relay request: ${options.method || "GET"} ${endpoint}`,
          redactSensitive(bodyData),
        )
      } catch {
        // Body is not JSON, log without redaction
        this.logger?.debug?.(
          `Relay request: ${options.method || "GET"} ${endpoint}`,
        )
      }
    } else {
      this.logger?.debug?.(
        `Relay request: ${options.method || "GET"} ${endpoint}`,
      )
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetch(endpoint, options)

        // Check if response indicates a retryable error
        if (!response.ok && RETRYABLE_STATUS_CODES.includes(response.status)) {
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText}`)
        }

        // Throw on non-retryable HTTP errors (4xx from upstream provider)
        // Previously these were silently treated as success, causing
        // callers to receive error JSON in place of expected data.
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(
            `HTTP ${response.status}: ${errorText.slice(0, 200)}`,
          )
        }

        // Parse response and log with redaction
        const responseText = await response.text()
        let responseData: T
        try {
          responseData = JSON.parse(responseText) as T
          this.logger?.debug?.(
            `Relay response: ${response.status}`,
            redactSensitive(responseData),
          )
        } catch {
          this.logger?.debug?.(
            `Relay response: ${response.status} (non-JSON)`,
          )
          throw new Error(
            `Invalid JSON response: ${responseText.slice(0, 100)}`,
          )
        }

        return responseData
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        // Check if we should retry
        const isRetryable = this.isRetryableError(lastError)

        // Don't retry if not retryable or this is the last attempt
        if (!isRetryable || attempt === this.maxRetries) {
          throw parseRelayError(lastError, { endpoint })
        }

        // Calculate backoff delay using Full Jitter
        const baseDelay = 1000 // 1 second
        const maxDelay = 10000 // 10 seconds max
        const delay = Math.round(calculateBackoffDelay(baseDelay, maxDelay, attempt))

        this.logger?.debug?.(
          `Relay API call failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms...`,
        )

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    // Should never reach here, but TypeScript needs it
    throw parseRelayError(lastError || new Error("Unknown error"), { endpoint })
  }

  /**
   * Register this deployment's webhook callback URL with the relay
   *
   * POST /api/open-banking/health with a callback_url body re-arms the
   * relay-side 24h callback registration (routing key userId-tokenId is
   * derived server-side from the authenticated token — no account_id is
   * sent). Requires an API key with openbanking scope.
   *
   * @param callbackUrl - Public URL of this deployment's webhook receiver
   * @returns Registration confirmation
   * @throws RelayHttpError | RelayError on failure (403 = key lacks openbanking scope)
   */
  async registerWebhookCallback(
    callbackUrl: string,
  ): Promise<RelayHealthCheckResponse> {
    return this.request<RelayHealthCheckResponse>("/api/open-banking/health", {
      method: "POST",
      body: JSON.stringify({ callback_url: callbackUrl } satisfies WebhookCallbackRegistration),
    })
  }

  /**
   * Check if relay service is available
   *
   * @param timeout - Health check timeout in milliseconds (default: 5000)
   * @returns Health check result with availability status
   */
  async healthCheck(
    timeout: number = DEFAULT_HEALTH_CHECK_TIMEOUT,
  ): Promise<RelayHealthCheckResult> {
    const startTime = Date.now()

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await fetch(`${this.baseUrl}/api/health`, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        })

        const latency = Date.now() - startTime

        if (response.ok) {
          return {
            available: true,
            latency,
          }
        }

        return {
          available: false,
          latency,
          error: `Health check returned ${response.status}`,
        }
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      const latency = Date.now() - startTime
      return {
        available: false,
        latency,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  /**
   * Make HTTP request to relay API with timeout
   *
   * @param endpoint - API endpoint (without base URL)
   * @param options - Fetch options
   * @returns Response object
   */
  private async fetch(
    endpoint: string,
    options: RequestInit,
  ): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`

    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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
      message.includes("econnreset") ||
      message.includes("network") ||
      message.includes("abort") || // Timeout
      message.includes("fetch failed")
    ) {
      return true
    }

    // HTTP status errors
    if (
      message.includes("http 500") ||
      message.includes("http 502") ||
      message.includes("http 503") ||
      message.includes("http 504") ||
      message.includes("http 429")
    ) {
      return true
    }

    return false
  }
}
