/**
 * Relay client types and interfaces
 *
 * Provides TypeScript types for relay client configuration,
 * health check results, and API responses.
 *
 * @packageDocumentation
 */

/**
 * RelayClient configuration
 */
export interface RelayClientConfig {
  /** Relay service base URL (e.g., https://relay.firela.io) */
  url: string
  /** API key for Bearer token authentication */
  apiKey: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number
}

/**
 * Health check result for relay availability
 */
export interface RelayHealthCheckResult {
  /** Whether the relay service is available */
  available: boolean
  /** Response latency in milliseconds (if available) */
  latency?: number
  /** Error message if health check failed */
  error?: string
}

/**
 * Generic relay API response wrapper
 */
export interface RelayApiResponse<T> {
  /** Whether the request was successful */
  success: boolean
  /** Response data (if successful) */
  data?: T
  /** Error details (if failed) */
  error?: {
    code: string
    message: string
  }
}

/**
 * Webhook callback registration (piggybacked on health check)
 *
 * The routing key is derived server-side from the authenticated API
 * token (userId-tokenId); no account_id is sent or accepted.
 */
export interface WebhookCallbackRegistration {
  /** BillClaw instance callback URL for webhook forwarding */
  callback_url: string
}

/**
 * Extended health check request body (backward-compatible)
 *
 * The health check endpoint accepts an optional body with callback_url.
 * If provided, relay registers the callback URL for webhook forwarding.
 * If omitted, relay performs health check only (backward-compatible).
 */
export interface RelayHealthCheckRequestBody {
  callback_url?: string
}

/**
 * Health check response (extended with webhook registration status)
 */
export interface RelayHealthCheckResponse {
  status: 'ok'
  version: string
  webhook_registered?: boolean
}

/**
 * Relay JWK proxy response
 *
 * Proxies Plaid's /webhook_verification_key/get response.
 */
export interface RelayJwkProxyResponse {
  key: {
    kid: string
    kty: string
    alg: string
    use: string
    crv: string
    x: string
    y: string
    created_at: number
    expired_at: number | null
  }
}

/**
 * Relay webhook forwarding specification
 *
 * Describes how relay forwards webhooks to BillClaw instances.
 */
export interface RelayWebhookForwarding {
  /** Original provider (e.g., 'plaid') */
  provider: string
  /** Raw body bytes forwarded without re-serialization */
  raw_body: string
  /** Original headers preserved from provider */
  headers: Record<string, string>
  /** Relay metadata */
  relay_meta?: {
    forwarded_at: string
    account_id: string
  }
}
