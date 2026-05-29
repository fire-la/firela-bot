/**
 * Error handling utilities for BillClaw
 *
 * Provides dual-mode error handling:
 * - Machine-readable: For AI agents (error codes, severity, executable actions)
 * - Human-readable: For display (title, message, suggestions)
 *
 * Framework-agnostic: Logger is provided via runtime abstraction.
 */

/**
 * Error categories for better user messaging
 */
export enum ErrorCategory {
  // Configuration errors
  CONFIG = "configuration",
  CREDENTIALS = "credentials",
  NETWORK = "network",

  // Plaid errors
  PLAID_API = "plaid_api",
  PLAID_AUTH = "plaid_auth",
  PLAID_ITEM = "plaid_item",

  // Gmail errors
  GMAIL_API = "gmail_api",
  GMAIL_AUTH = "gmail_auth",

  // Storage errors
  STORAGE = "storage",
  FILE_SYSTEM = "file_system",

  // Webhook errors (inbound webhook receiver)
  WEBHOOK = "webhook",

  // OAuth errors (OAuth flow and device code flow)
  OAUTH = "oauth",

  // VLT errors
  VLT = "vlt",

  // Relay errors
  RELAY = "relay",
  RELAY_PROVIDER = "relay_provider",

  // General errors
  UNKNOWN = "unknown",
}

/**
 * Error codes for programmatic error handling
 * Used by AI agents for switch/case logic and decision making
 */
export const ERROR_CODES = {
  // Lock errors
  LOCK_ACQUISITION_FAILED: "LOCK_ACQUISITION_FAILED",
  LOCK_TIMEOUT: "LOCK_TIMEOUT",
  LOCK_STALE: "LOCK_STALE",

  // Credential errors
  CREDENTIALS_NOT_FOUND: "CREDENTIALS_NOT_FOUND",
  CREDENTIALS_STORAGE_FAILED: "CREDENTIALS_STORAGE_FAILED",
  CREDENTIALS_KEYCHAIN_FAILED: "CREDENTIALS_KEYCHAIN_FAILED",

  // Network errors
  NETWORK_CONNECTION_REFUSED: "NETWORK_CONNECTION_REFUSED",
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  NETWORK_DNS_FAILED: "NETWORK_DNS_FAILED",
  NETWORK_GENERIC: "NETWORK_GENERIC",

  // Plaid errors
  PLAID_ITEM_LOGIN_REQUIRED: "PLAID_ITEM_LOGIN_REQUIRED",
  PLAID_INVALID_ACCESS_TOKEN: "PLAID_INVALID_ACCESS_TOKEN",
  PLAID_PRODUCT_NOT_READY: "PLAID_PRODUCT_NOT_READY",
  PLAID_RATE_LIMIT_EXCEEDED: "PLAID_RATE_LIMIT_EXCEEDED",
  PLAID_INSTITUTION_DOWN: "PLAID_INSTITUTION_DOWN",
  PLAID_INVALID_CREDENTIALS: "PLAID_INVALID_CREDENTIALS",
  PLAID_API_ERROR: "PLAID_API_ERROR",

  // Gmail errors
  GMAIL_AUTH_FAILED: "GMAIL_AUTH_FAILED",
  GMAIL_ACCESS_DENIED: "GMAIL_ACCESS_DENIED",
  GMAIL_API_NOT_FOUND: "GMAIL_API_NOT_FOUND",
  GMAIL_RATE_LIMIT_EXCEEDED: "GMAIL_RATE_LIMIT_EXCEEDED",
  GMAIL_API_ERROR: "GMAIL_API_ERROR",

  // Storage errors
  STORAGE_DISK_FULL: "STORAGE_DISK_FULL",
  STORAGE_WRITE_FAILED: "STORAGE_WRITE_FAILED",
  STORAGE_READ_FAILED: "STORAGE_READ_FAILED",

  // File system errors
  FS_PERMISSION_DENIED: "FS_PERMISSION_DENIED",
  FS_NOT_FOUND: "FS_NOT_FOUND",
  FS_GENERIC: "FS_GENERIC",

  // Config errors
  CONFIG_INVALID: "CONFIG_INVALID",
  CONFIG_MISSING: "CONFIG_MISSING",
  CONFIG_PARSE_FAILED: "CONFIG_PARSE_FAILED",

  // Webhook errors
  WEBHOOK_START_FAILED: "WEBHOOK_START_FAILED",
  WEBHOOK_STOP_FAILED: "WEBHOOK_STOP_FAILED",
  WEBHOOK_CONFIG_INVALID: "WEBHOOK_CONFIG_INVALID",
  WEBHOOK_MODE_SWITCH_FAILED: "WEBHOOK_MODE_SWITCH_FAILED",
  WEBHOOK_RECEIVER_NOT_CONFIGURED: "WEBHOOK_RECEIVER_NOT_CONFIGURED",
  WEBHOOK_HEALTH_CHECK_FAILED: "WEBHOOK_HEALTH_CHECK_FAILED",
  WEBHOOK_DIRECT_UNAVAILABLE: "WEBHOOK_DIRECT_UNAVAILABLE",
  WEBHOOK_SETUP_FAILED: "WEBHOOK_SETUP_FAILED",

  // OAuth errors (OAuth flow and device code flow)
  OAUTH_TIMEOUT: "OAUTH_TIMEOUT",
  OAUTH_POLLING_TIMEOUT: "OAUTH_POLLING_TIMEOUT",
  OAUTH_FAILED: "OAUTH_FAILED",
  OAUTH_CANCELLED: "OAUTH_CANCELLED",
  OAUTH_STATE_INVALID: "OAUTH_STATE_INVALID",
  OAUTH_STATE_EXPIRED: "OAUTH_STATE_EXPIRED",
  OAUTH_DEVICE_CODE_EXPIRED: "OAUTH_DEVICE_CODE_EXPIRED",
  OAUTH_DEVICE_CODE_FAILED: "OAUTH_DEVICE_CODE_FAILED",
  OAUTH_AUTHORIZATION_PENDING: "OAUTH_AUTHORIZATION_PENDING",
  OAUTH_SLOW_DOWN: "OAUTH_SLOW_DOWN",
  OAUTH_ACCESS_DENIED: "OAUTH_ACCESS_DENIED",
  OAUTH_BROWSER_LAUNCH_FAILED: "OAUTH_BROWSER_LAUNCH_FAILED",
  OAUTH_CREDENTIAL_MISSING: "OAUTH_CREDENTIAL_MISSING",
  OAUTH_PLAID_LINK_TOKEN_FAILED: "OAUTH_PLAID_LINK_TOKEN_FAILED",
  OAUTH_PLAID_PUBLIC_TOKEN_FAILED: "OAUTH_PLAID_PUBLIC_TOKEN_FAILED",
  OAUTH_GMAIL_AUTH_URL_FAILED: "OAUTH_GMAIL_AUTH_URL_FAILED",
  OAUTH_GMAIL_CODE_EXCHANGE_FAILED: "OAUTH_GMAIL_CODE_EXCHANGE_FAILED",
  OAUTH_GMAIL_API_ERROR: "OAUTH_GMAIL_API_ERROR",

  // VLT errors
  VLT_AUTH_FAILED: "VLT_AUTH_FAILED",
  VLT_TOKEN_EXPIRED: "VLT_TOKEN_EXPIRED",
  VLT_API_ERROR: "VLT_API_ERROR",
  VLT_UPLOAD_FAILED: "VLT_UPLOAD_FAILED",
  VLT_REGION_INVALID: "VLT_REGION_INVALID",
  VLT_CONNECTION_FAILED: "VLT_CONNECTION_FAILED",
  VLT_RATE_LIMITED: "VLT_RATE_LIMITED",

  // Relay errors
  RELAY_NOT_CONFIGURED: "RELAY_NOT_CONFIGURED",
  RELAY_CONNECTION_FAILED: "RELAY_CONNECTION_FAILED",
  RELAY_TIMEOUT: "RELAY_TIMEOUT",
  RELAY_RATE_LIMITED: "RELAY_RATE_LIMITED",
  RELAY_AUTH_FAILED: "RELAY_AUTH_FAILED",
  RELAY_PROVIDER_ERROR: "RELAY_PROVIDER_ERROR",

  // Plaid Relay errors (mapped from ToyKit relay)
  PLAID_RELAY_BANK_CONNECTION_EXPIRED: "PLAID_RELAY_BANK_CONNECTION_EXPIRED",
  PLAID_RELAY_LINK_TOKEN_EXPIRED: "PLAID_RELAY_LINK_TOKEN_EXPIRED",
  PLAID_RELAY_INVALID_TOKEN: "PLAID_RELAY_INVALID_TOKEN",
  PLAID_RELAY_INSTITUTION_DOWN: "PLAID_RELAY_INSTITUTION_DOWN",
  PLAID_RELAY_RATE_LIMITED: "PLAID_RELAY_RATE_LIMITED",
  PLAID_RELAY_AUTH_REQUIRED: "PLAID_RELAY_AUTH_REQUIRED",

  // GoCardless Relay errors (mapped from ToyKit relay)
  GOCARDLESS_RELAY_TOKEN_EXPIRED: "GOCARDLESS_RELAY_TOKEN_EXPIRED",
  GOCARDLESS_RELAY_REQUISITION_NOT_FOUND: "GOCARDLESS_RELAY_REQUISITION_NOT_FOUND",
  GOCARDLESS_RELAY_ACCESS_DENIED: "GOCARDLESS_RELAY_ACCESS_DENIED",
  GOCARDLESS_RELAY_RATE_LIMITED: "GOCARDLESS_RELAY_RATE_LIMITED",
  GOCARDLESS_RELAY_INSTITUTION_DOWN: "GOCARDLESS_RELAY_INSTITUTION_DOWN",

  // Generic
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * Severity levels for error prioritization
 */
export type ErrorSeverity = "fatal" | "error" | "warning" | "info"

/**
 * AI-executable action types
 * These represent actions an AI agent can take to recover from errors
 */
export type ActionType =
  | "retry" // Retry the operation with optional delay
  | "oauth_reauth" // Trigger OAuth re-authentication flow
  | "reauth" // Re-authenticate (generic, used by GoCardless)
  | "config_change" // Request configuration change
  | "abort" // Abort the operation
  | "wait" // Wait for a condition before retrying
  | "manual_intervention" // Require human assistance
  | "ignore" // Error can be safely ignored

/**
 * AI-executable action for error recovery
 */
export interface ErrorAction {
  type: ActionType
  tool?: string // Tool name to call (e.g., "plaid_oauth")
  params?: Record<string, unknown> // Parameters for the action
  delayMs?: number // Delay before retry (for retry action)
  description?: string // Human-readable description of the action
}

/**
 * Structured entity references for error context
 * Helps AI agents identify which entities are affected by the error
 */
export interface ErrorEntities {
  accountId?: string
  institutionId?: string
  itemId?: string
  filePath?: string
  configKey?: string
  [key: string]: string | undefined
}

/**
 * Human-readable error information
 * Used for display to users
 */
export interface HumanReadableError {
  title: string
  message: string
  suggestions: string[]
  docsLink?: string
}

/**
 * User-friendly error with dual-mode support
 *
 * - Machine-readable fields: errorCode, severity, recoverable, nextActions, entities
 * - Human-readable fields: humanReadable (title, message, suggestions, docsLink)
 */
export interface UserError {
  // === Type discriminator ===
  type: "UserError"

  // === Machine-readable fields (AI agents) ===
  errorCode: ErrorCode
  category: ErrorCategory
  severity: ErrorSeverity
  recoverable: boolean

  // === AI-executable actions ===
  nextActions?: ErrorAction[]

  // === Structured entity references ===
  entities?: ErrorEntities

  // === Human-readable fields (display) ===
  humanReadable: HumanReadableError

  // === Debug info ===
  originalError?: Error
  timestamp?: string
}

/**
 * Logger interface for framework-agnostic logging
 */
export interface Logger {
  info(...args: unknown[]): void
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
  debug(...args: unknown[]): void
}

/**
 * Partial logger type for logError function
 * Accepts both full Logger and partial logger implementations
 */
export type PartialLogger = Partial<Logger>

/**
 * Create a user-friendly error with dual-mode support
 *
 * @param errorCode - Machine-readable error code
 * @param category - Error category
 * @param severity - Error severity level
 * @param recoverable - Whether the error is recoverable
 * @param humanReadable - Human-readable error information
 * @param nextActions - AI-executable recovery actions
 * @param entities - Structured entity references
 * @param originalError - Original error for debugging
 */
export function createUserError(
  errorCode: ErrorCode,
  category: ErrorCategory,
  severity: ErrorSeverity,
  recoverable: boolean,
  humanReadable: HumanReadableError,
  nextActions?: ErrorAction[],
  entities?: ErrorEntities,
  originalError?: Error,
): UserError {
  return {
    type: "UserError",
    errorCode,
    category,
    severity,
    recoverable,
    humanReadable,
    nextActions,
    entities,
    originalError,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Format error for display to user
 * Uses the humanReadable field for user-friendly output
 */
export function formatError(error: UserError): string {
  const lines: string[] = []

  // Header with category emoji and severity
  const categoryEmoji = getCategoryEmoji(error.category)
  const severityIndicator = getSeverityIndicator(error.severity)
  lines.push(`${categoryEmoji} ${error.humanReadable.title} ${severityIndicator}`)
  lines.push("")

  // Message
  lines.push(error.humanReadable.message)
  lines.push("")

  // Suggestions
  if (error.humanReadable.suggestions.length > 0) {
    lines.push("Suggestions:")
    for (let i = 0; i < error.humanReadable.suggestions.length; i++) {
      lines.push(`   ${i + 1}. ${error.humanReadable.suggestions[i]}`)
    }
  }

  // Docs link
  if (error.humanReadable.docsLink) {
    lines.push("")
    lines.push(`Learn more: ${error.humanReadable.docsLink}`)
  }

  // Error code (for debugging/Support)
  lines.push("")
  lines.push(`Error code: ${error.errorCode}`)

  return lines.join("\n")
}

// Re-export OAuth error handling functions
export * from "./oauth-errors.js"
export type { OAuthErrorContext } from "./oauth-errors.js"
function getSeverityIndicator(severity: ErrorSeverity): string {
  const indicators: Record<ErrorSeverity, string> = {
    fatal: "🔴",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  }
  return indicators[severity] || ""
}

/**
 * Get emoji for error category
 */
function getCategoryEmoji(category: ErrorCategory): string {
  const emojis: Record<ErrorCategory, string> = {
    [ErrorCategory.CONFIG]: "⚙️",
    [ErrorCategory.CREDENTIALS]: "🔑",
    [ErrorCategory.NETWORK]: "🌐",
    [ErrorCategory.PLAID_API]: "🏦",
    [ErrorCategory.PLAID_AUTH]: "🔐",
    [ErrorCategory.PLAID_ITEM]: "📝",
    [ErrorCategory.GMAIL_API]: "📧",
    [ErrorCategory.GMAIL_AUTH]: "🔐",
    [ErrorCategory.STORAGE]: "💾",
    [ErrorCategory.FILE_SYSTEM]: "📁",
    [ErrorCategory.WEBHOOK]: "🪝",
    [ErrorCategory.OAUTH]: "🔑",
    [ErrorCategory.VLT]: "📤",
    [ErrorCategory.RELAY]: "🔗",
    [ErrorCategory.RELAY_PROVIDER]: "🔌",
    [ErrorCategory.UNKNOWN]: "❓",
  }
  return emojis[category] || "❓"
}

/**
 * Parse Plaid error codes and create user-friendly errors
 */
export function parsePlaidError(
  error: {
    error_code?: string
    error_message?: string
    error_type?: string
    display_message?: string
    request_id?: string
    item_id?: string
    institution_id?: string
  },
  accountId?: string,
): UserError {
  const errorCode = error.error_code || "UNKNOWN"
  const errorMessage =
    error.error_message || error.display_message || "An error occurred"
  const requestId = error.request_id

  // Login required
  if (
    errorCode === "ITEM_LOGIN_REQUIRED" ||
    error.error_type === "ITEM_LOGIN_REQUIRED"
  ) {
    return createUserError(
      ERROR_CODES.PLAID_ITEM_LOGIN_REQUIRED,
      ErrorCategory.PLAID_AUTH,
      "error",
      true,
      {
        title: "Account Re-Authentication Required",
        message:
          "Your bank account requires re-authentication. This happens when your bank credentials have changed or expired.",
        suggestions: [
          "Re-authenticate via your adapter's setup command",
          "This will open a secure browser window where you can log into your bank",
          "After re-authentication, your transactions will sync normally",
        ],
        docsLink: "https://plaid.com/docs/errors/#item-login-required",
      },
      [
        {
          type: "oauth_reauth",
          tool: "plaid_oauth",
          params: { accountId, item_id: error.item_id },
          description: "Trigger OAuth re-authentication flow",
        },
      ],
      { accountId, itemId: error.item_id, institutionId: error.institution_id },
    )
  }

  // Invalid credentials
  if (
    errorCode === "INVALID_ACCESS_TOKEN" ||
    error.error_type === "INVALID_ACCESS_TOKEN"
  ) {
    return createUserError(
      ERROR_CODES.PLAID_INVALID_ACCESS_TOKEN,
      ErrorCategory.PLAID_AUTH,
      "error",
      true,
      {
        title: "Invalid Access Token",
        message:
          "Your access token is invalid. This can happen if the token was revoked or corrupted.",
        suggestions: [
          "Run your adapter's setup command to reconnect your account",
          "If this persists, remove and re-add the account",
        ],
        docsLink: "https://plaid.com/docs/errors/#invalid-access-token",
      },
      [
        {
          type: "oauth_reauth",
          tool: "plaid_oauth",
          params: { accountId },
          description: "Re-authenticate to get a new access token",
        },
      ],
      { accountId, itemId: error.item_id },
    )
  }

  // Product not ready
  if (errorCode === "PRODUCT_NOT_READY") {
    return createUserError(
      ERROR_CODES.PLAID_PRODUCT_NOT_READY,
      ErrorCategory.PLAID_API,
      "warning",
      true,
      {
        title: "Account Not Ready",
        message:
          "Your account is not fully set up yet. Plaid is still processing your account information.",
        suggestions: [
          "Wait a few minutes and try again",
          "If this persists, contact Plaid support",
        ],
        docsLink: "https://plaid.com/docs/errors/#product-not-ready",
      },
      [
        {
          type: "retry",
          delayMs: 60000,
          description: "Retry after 1 minute",
        },
      ],
      { accountId, itemId: error.item_id },
    )
  }

  // Rate limit
  if (errorCode === "RATE_LIMIT_EXCEEDED") {
    return createUserError(
      ERROR_CODES.PLAID_RATE_LIMIT_EXCEEDED,
      ErrorCategory.PLAID_API,
      "warning",
      true,
      {
        title: "API Rate Limit Exceeded",
        message:
          "Too many requests have been made to the Plaid API. Please wait before trying again.",
        suggestions: [
          "Wait a few minutes before syncing again",
          "Consider syncing less frequently (e.g., daily instead of hourly)",
          "If you need higher rate limits, upgrade your Plaid plan",
        ],
        docsLink: "https://plaid.com/docs/errors/#rate-limit-exceeded",
      },
      [
        {
          type: "retry",
          delayMs: 300000, // 5 minutes
          description: "Retry after 5 minutes",
        },
      ],
      { accountId },
    )
  }

  // Institution down
  if (errorCode === "INSTITUTION_DOWN") {
    return createUserError(
      ERROR_CODES.PLAID_INSTITUTION_DOWN,
      ErrorCategory.PLAID_API,
      "warning",
      true,
      {
        title: "Bank temporarily unavailable",
        message:
          "Your bank's systems are temporarily down for maintenance.",
        suggestions: [
          "Wait a few minutes and try again",
          "Check your bank's website for service status updates",
          "Your transactions will sync automatically once the bank is back online",
        ],
      },
      [
        {
          type: "retry",
          delayMs: 300000, // 5 minutes
          description: "Retry after 5 minutes",
        },
      ],
      {
        accountId,
        institutionId: error.institution_id,
      },
    )
  }

  // Invalid credentials
  if (errorCode === "INVALID_CREDENTIALS") {
    return createUserError(
      ERROR_CODES.PLAID_INVALID_CREDENTIALS,
      ErrorCategory.PLAID_API,
      "error",
      false,
      {
        title: "Invalid API Credentials",
        message:
          "The Plaid API credentials configured are invalid.",
        suggestions: [
          "Configure your Plaid client ID and secret",
          "Verify your credentials at https://dashboard.plaid.com",
        ],
        docsLink: "https://dashboard.plaid.com",
      },
      [
        {
          type: "config_change",
          params: { setting: "plaid_credentials" },
          description: "Update Plaid API credentials",
        },
      ],
      {},
    )
  }

  // Generic Plaid error
  return createUserError(
    ERROR_CODES.PLAID_API_ERROR,
    ErrorCategory.PLAID_API,
    "error",
    true,
    {
      title: "Plaid API Error",
      message: `${errorMessage}${requestId ? ` (Request ID: ${requestId})` : ""}`,
      suggestions: [
        "Try again in a few minutes",
        "Check Plaid status at https://status.plaid.com",
      ],
      docsLink: "https://plaid.com/docs/errors/",
    },
    [
      {
        type: "retry",
        delayMs: 60000,
        description: "Retry after 1 minute",
      },
    ],
    { accountId, itemId: error.item_id },
  )
}

/**
 * Parse Gmail API errors and create user-friendly errors
 */
export function parseGmailError(
  error: {
    code?: number
    message?: string
    status?: number
  },
  accountId?: string,
): UserError {
  const statusCode = error.status || error.code || 0

  // Unauthorized
  if (statusCode === 401) {
    return createUserError(
      ERROR_CODES.GMAIL_AUTH_FAILED,
      ErrorCategory.GMAIL_AUTH,
      "error",
      true,
      {
        title: "Gmail Authentication Failed",
        message:
          "Your Gmail access has expired or been revoked. You need to re-authenticate.",
        suggestions: [
          "Re-authenticate with Gmail via your adapter's setup command",
          "Make sure you grant read-only access to your Gmail",
          "Check that Google Cloud OAuth credentials are valid",
        ],
        docsLink: "https://developers.google.com/gmail/api/auth",
      },
      [
        {
          type: "oauth_reauth",
          tool: "gmail_oauth",
          params: { accountId },
          description: "Re-authenticate with Gmail",
        },
      ],
      { accountId },
    )
  }

  // Forbidden
  if (statusCode === 403) {
    return createUserError(
      ERROR_CODES.GMAIL_ACCESS_DENIED,
      ErrorCategory.GMAIL_API,
      "error",
      false,
      {
        title: "Gmail Access Denied",
        message:
          "Access to Gmail was denied. This usually means the OAuth token lacks the required permissions.",
        suggestions: [
          "Make sure the Gmail API is enabled in Google Cloud Console",
          "Verify that the OAuth consent screen includes 'gmail.readonly' scope",
          "Re-authenticate to grant proper permissions",
        ],
        docsLink: "https://developers.google.com/gmail/api/auth",
      },
      [
        {
          type: "oauth_reauth",
          tool: "gmail_oauth",
          params: { accountId },
          description: "Re-authenticate with proper permissions",
        },
      ],
      { accountId },
    )
  }

  // Not found
  if (statusCode === 404) {
    return createUserError(
      ERROR_CODES.GMAIL_API_NOT_FOUND,
      ErrorCategory.GMAIL_API,
      "error",
      false,
      {
        title: "Gmail API Not Found",
        message:
          "The Gmail API endpoint could not be found. This may be a configuration issue.",
        suggestions: [
          "Verify the Gmail API is enabled in your Google Cloud project",
          "Check that the API name is correct: 'gmail.api'",
          "Try re-enabling the Gmail API in Google Cloud Console",
        ],
        docsLink:
          "https://console.cloud.google.com/apis/library/gmail-api",
      },
      [
        {
          type: "config_change",
          params: { setting: "gmail_api_enabled" },
          description: "Enable Gmail API in Google Cloud Console",
        },
      ],
      {},
    )
  }

  // Rate limit
  if (statusCode === 429) {
    return createUserError(
      ERROR_CODES.GMAIL_RATE_LIMIT_EXCEEDED,
      ErrorCategory.GMAIL_API,
      "warning",
      true,
      {
        title: "Gmail API Rate Limit Exceeded",
        message:
          "Too many requests have been made to the Gmail API. You've hit the daily quota limit.",
        suggestions: [
          "Wait until tomorrow when the quota resets",
          "Reduce sync frequency to avoid hitting the limit",
          "Consider using Gmail push notifications instead of polling",
          "Free tier: 250 quota units/day",
        ],
        docsLink: "https://developers.google.com/gmail/api/v1/quota",
      },
      [
        {
          type: "wait",
          description: "Wait until quota resets (usually daily)",
        },
      ],
      { accountId },
    )
  }

  // Generic Gmail error
  return createUserError(
    ERROR_CODES.GMAIL_API_ERROR,
    ErrorCategory.GMAIL_API,
    "error",
    true,
    {
      title: "Gmail API Error",
      message:
        error.message ||
        "An error occurred while communicating with Gmail",
      suggestions: [
        "Check your internet connection",
        "Verify Gmail API is enabled in Google Cloud Console",
        "Try again in a few minutes",
      ],
      docsLink: "https://developers.google.com/gmail/api",
    },
    [
      {
        type: "retry",
        delayMs: 60000,
        description: "Retry after 1 minute",
      },
    ],
    { accountId },
  )
}

/**
 * Parse network errors
 */
export function parseNetworkError(error: Error): UserError {
  const message = error.message.toLowerCase()

  // Connection refused
  if (
    message.includes("econnrefused") ||
    message.includes("connection refused")
  ) {
    return createUserError(
      ERROR_CODES.NETWORK_CONNECTION_REFUSED,
      ErrorCategory.NETWORK,
      "error",
      true,
      {
        title: "Connection Refused",
        message:
          "Could not connect to the server. The service may be down or your network is blocking the connection.",
        suggestions: [
          "Check your internet connection",
          "Verify you're not behind a firewall or proxy",
          "If using a VPN, try disconnecting it",
          "Check if the service is temporarily down",
        ],
      },
      [
        {
          type: "retry",
          delayMs: 30000,
          description: "Retry after 30 seconds",
        },
      ],
      {},
      error,
    )
  }

  // Timeout
  if (message.includes("timeout") || message.includes("timed out")) {
    return createUserError(
      ERROR_CODES.NETWORK_TIMEOUT,
      ErrorCategory.NETWORK,
      "warning",
      true,
      {
        title: "Request Timeout",
        message:
          "The request took too long to complete. This could be due to slow network or server issues.",
        suggestions: [
          "Check your internet connection speed",
          "Try again in a few minutes",
          "If syncing many transactions, consider reducing the date range",
        ],
      },
      [
        {
          type: "retry",
          delayMs: 60000,
          description: "Retry after 1 minute",
        },
      ],
      {},
      error,
    )
  }

  // DNS resolution failed
  if (message.includes("enotfound") || message.includes("getaddrinfo")) {
    return createUserError(
      ERROR_CODES.NETWORK_DNS_FAILED,
      ErrorCategory.NETWORK,
      "error",
      false,
      {
        title: "DNS Resolution Failed",
        message:
          "Could not resolve the server address. This might be a DNS or network configuration issue.",
        suggestions: [
          "Check your internet connection",
          "Try switching to a different DNS server (e.g., 8.8.8.8)",
          "Flush your DNS cache",
          "If you're using a VPN, try disconnecting it",
        ],
      },
      [
        {
          type: "manual_intervention",
          description: "Manual network configuration may be required",
        },
      ],
      {},
      error,
    )
  }

  // Generic network error
  return createUserError(
    ERROR_CODES.NETWORK_GENERIC,
    ErrorCategory.NETWORK,
    "error",
    true,
    {
      title: "Network Error",
      message:
        error.message ||
        "An error occurred while communicating with the server",
      suggestions: [
        "Check your internet connection",
        "Try again in a few minutes",
        "If the problem persists, check your network settings",
      ],
    },
    [
      {
        type: "retry",
        delayMs: 60000,
        description: "Retry after 1 minute",
      },
    ],
    {},
    error,
  )
}

/**
 * Parse file system errors
 */
export function parseFileSystemError(
  error: Error,
  filePath?: string,
): UserError {
  const code = (error as any).code
  const message = error.message

  // Permission denied
  if (code === "EACCES" || code === "EPERM") {
    return createUserError(
      ERROR_CODES.FS_PERMISSION_DENIED,
      ErrorCategory.FILE_SYSTEM,
      "error",
      false,
      {
        title: "Permission Denied",
        message: `Cannot access ${
          filePath || "file or directory"
        }. You don't have the required permissions.`,
        suggestions: [
          "Check file/directory permissions",
          "Ensure the user has read/write access to the data directory",
        ],
      },
      [
        {
          type: "manual_intervention",
          description: "Fix file/directory permissions manually",
        },
      ],
      { filePath },
      error,
    )
  }

  // No space left
  if (code === "ENOSPC") {
    return createUserError(
      ERROR_CODES.STORAGE_DISK_FULL,
      ErrorCategory.STORAGE,
      "fatal",
      false,
      {
        title: "Disk Full",
        message:
          "No space left on device. Cannot save transactions.",
        suggestions: [
          "Free up disk space by deleting unnecessary files",
          "Consider moving the BillClaw data directory to a drive with more space",
        ],
      },
      [
        {
          type: "manual_intervention",
          description: "Free up disk space manually",
        },
      ],
      {},
      error,
    )
  }

  // Directory not found
  if (code === "ENOENT" && message.includes("no such file")) {
    return createUserError(
      ERROR_CODES.FS_NOT_FOUND,
      ErrorCategory.FILE_SYSTEM,
      "error",
      false,
      {
        title: "File or Directory Not Found",
        message: `The file or directory ${filePath || ""} does not exist.`,
        suggestions: [
          "Run setup to initialize BillClaw",
          "Verify the data directory path is correct",
        ],
      },
      [
        {
          type: "config_change",
          params: { setting: "data_directory" },
          description: "Update data directory path",
        },
      ],
      { filePath },
      error,
    )
  }

  // Generic file system error
  return createUserError(
    ERROR_CODES.FS_GENERIC,
    ErrorCategory.FILE_SYSTEM,
    "error",
    true,
    {
      title: "File System Error",
      message:
        message ||
        "An error occurred while accessing the file system",
      suggestions: [
        "Check file/directory permissions",
        "Ensure the data directory exists and is writable",
        "Try running setup to reinitialize",
      ],
    },
    [
      {
        type: "manual_intervention",
        description: "Manual intervention may be required",
      },
    ],
    { filePath },
    error,
  )
}

/**
 * Parse webhook manager errors (start, stop, config, health check)
 *
 * @param error - Error from webhook manager
 * @param context - Additional context (mode, port, publicUrl)
 * @returns UserError with appropriate webhook error code
 */
export function parseWebhookError(
  error: Error | { code?: string; message?: string },
  context?: {
    mode?: string
    port?: number
    publicUrl?: string
  },
): UserError {
  const message = error.message || String(error)
  const code = (error as any).code

  // Convert context to ErrorEntities format (string values only)
  const entities: ErrorEntities = {}
  if (context?.mode) entities.mode = context.mode
  if (context?.port !== undefined) entities.port = String(context.port)
  if (context?.publicUrl) entities.publicUrl = context.publicUrl

  // Start failed
  if (
    message.includes("start") ||
    message.includes("listen") ||
    code === "START_FAILED"
  ) {
    return createUserError(
      ERROR_CODES.WEBHOOK_START_FAILED,
      ErrorCategory.WEBHOOK,
      "error",
      true,
      {
        title: "Webhook Receiver Start Failed",
        message:
          "Failed to start the webhook receiver. The port may be in use or configuration may be invalid.",
        suggestions: [
          "Check if another service is using the configured port",
          "Verify the webhook configuration is valid",
          "Check system logs for more details",
        ],
      },
      [
        {
          type: "config_change",
          params: { setting: "connect.port" },
          description: "Change the webhook port",
        },
        {
          type: "retry",
          description: "Retry starting the webhook receiver",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Stop failed
  if (
    message.includes("stop") ||
    message.includes("shutdown") ||
    code === "STOP_FAILED"
  ) {
    return createUserError(
      ERROR_CODES.WEBHOOK_STOP_FAILED,
      ErrorCategory.WEBHOOK,
      "warning",
      false,
      {
        title: "Webhook Receiver Stop Failed",
        message: "Failed to gracefully stop the webhook receiver.",
        suggestions: [
          "The receiver may still be running in the background",
          "You can force stop by killing the process",
          "Check system logs for more details",
        ],
      },
      [
        {
          type: "manual_intervention",
          description: "Manual intervention may be required to stop the service",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Config invalid
  if (
    message.includes("config") ||
    message.includes("invalid") ||
    message.includes("validation") ||
    code === "CONFIG_INVALID"
  ) {
    return createUserError(
      ERROR_CODES.WEBHOOK_CONFIG_INVALID,
      ErrorCategory.CONFIG,
      "error",
      true,
      {
        title: "Webhook Configuration Invalid",
        message:
          "The webhook configuration is invalid. Please check your settings.",
        suggestions: [
          "Verify the configuration format is correct",
          "Check that required fields are present",
          "Run setup wizard to reconfigure",
        ],
        docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/user-guide.md#webhook-configuration",
      },
      [
        {
          type: "config_change",
          description: "Fix the configuration",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Mode switch failed
  if (
    message.includes("mode") ||
    message.includes("switch") ||
    code === "MODE_SWITCH_FAILED"
  ) {
    return createUserError(
      ERROR_CODES.WEBHOOK_MODE_SWITCH_FAILED,
      ErrorCategory.WEBHOOK,
      "warning",
      true,
      {
        title: "Webhook Mode Switch Failed",
        message:
          "Failed to switch webhook receiver mode. The receiver may need to be restarted.",
        suggestions: [
          "Stop the receiver before switching modes",
          "Verify the target mode configuration is valid",
          "Check system logs for more details",
        ],
      },
      [
        {
          type: "retry",
          description: "Retry switching modes",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Receiver not configured
  if (
    message.includes("not configured") ||
    message.includes("not enabled") ||
    code === "NOT_CONFIGURED"
  ) {
    return createUserError(
      ERROR_CODES.WEBHOOK_RECEIVER_NOT_CONFIGURED,
      ErrorCategory.CONFIG,
      "warning",
      true,
      {
        title: "Webhook Receiver Not Configured",
        message:
          "The webhook receiver is not configured. Please run setup to enable it.",
        suggestions: [
          "Run 'bills setup' to configure the webhook receiver",
          "Select a mode (auto, direct, or polling)",
        ],
        docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/user-guide.md#webhook-configuration",
      },
      [
        {
          type: "config_change",
          description: "Run setup to configure webhook receiver",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Health check failed
  if (
    message.includes("health") ||
    message.includes("unhealthy") ||
    code === "HEALTH_CHECK_FAILED"
  ) {
    return createUserError(
      ERROR_CODES.WEBHOOK_HEALTH_CHECK_FAILED,
      ErrorCategory.WEBHOOK,
      "warning",
      true,
      {
        title: "Webhook Receiver Health Check Failed",
        message:
          "The webhook receiver health check indicates an issue with the service.",
        suggestions: [
          "Check the receiver status for more details",
          "Verify the network connection",
          "Try restarting the webhook receiver",
        ],
      },
      [
        {
          type: "retry",
          description: "Retry the health check",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Direct mode unavailable
  if (
    message.includes("public url") ||
    message.includes("direct mode") ||
    code === "DIRECT_UNAVAILABLE"
  ) {
    return createUserError(
      ERROR_CODES.WEBHOOK_DIRECT_UNAVAILABLE,
      ErrorCategory.WEBHOOK,
      "warning",
      true,
      {
        title: "Direct Mode Unavailable",
        message:
          "Direct webhook mode requires a public URL but none is configured or accessible.",
        suggestions: [
          "Configure a public URL in settings",
          "Use polling mode as a fallback",
        ],
        docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/user-guide.md#webhook-modes",
      },
      [
        {
          type: "config_change",
          params: { mode: "polling" },
          description: "Switch to polling mode",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Generic webhook setup failed
  return createUserError(
    ERROR_CODES.WEBHOOK_SETUP_FAILED,
    ErrorCategory.WEBHOOK,
    "error",
    true,
    {
      title: "Webhook Setup Failed",
      message: `Failed to setup webhook receiver: ${message}`,
      suggestions: [
        "Check the configuration is valid",
        "Verify required services are available",
        "Check system logs for more details",
      ],
    },
    [
      {
        type: "retry",
        description: "Retry webhook setup",
      },
    ],
    entities,
    error instanceof Error ? error : undefined,
  )
}

/**
 * Type guard to check if error is a UserError
 */
export function isUserError(error: unknown): error is UserError {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as UserError).type === "UserError" &&
    "errorCode" in error &&
    "humanReadable" in error
  )
}

/**
 * Log error with context for debugging
 */
export function logError(
  logger: PartialLogger | undefined,
  error: UserError | Error,
  context?: Record<string, unknown>,
): void {
  const logData = {
    timestamp: isUserError(error) ? error.timestamp : new Date().toISOString(),
    errorCode: isUserError(error) ? error.errorCode : undefined,
    category: isUserError(error) ? error.category : ErrorCategory.UNKNOWN,
    severity: isUserError(error) ? error.severity : undefined,
    recoverable: isUserError(error) ? error.recoverable : undefined,
    message: isUserError(error) ? error.humanReadable.message : error.message,
    entities: isUserError(error) ? error.entities : undefined,
    context,
  } as Record<string, unknown>

  if (isUserError(error) && error.originalError) {
    logData.originalError = {
      name: error.originalError.name,
      message: error.originalError.message,
      stack: error.originalError.stack,
    }
  }

  logger?.error?.("BillClaw error:", JSON.stringify(logData, null, 2))
}

/**
 * Parse VLT API errors and *
 * @param error - Error from VLT API
 * @param context - Additional context (region, endpoint)
 * @returns UserError with appropriate VLT error code
 */
export function parseVltError(
  error: Error | { code?: string; message?: string; status?: number },
  context?: {
    region?: string
    endpoint?: string
  },
): UserError {
  const message = error.message || String(error)
  const statusCode = (error as any).status

  // Convert context to ErrorEntities format
  const entities: ErrorEntities = {}
  if (context?.region) entities.region = context.region
  if (context?.endpoint) entities.endpoint = context.endpoint

  // Authentication failed (401)
  if (statusCode === 401 || message.includes("401") || message.includes("Unauthorized")) {
    return createUserError(
      ERROR_CODES.VLT_AUTH_FAILED,
      ErrorCategory.VLT,
      "error",
      true,
      {
        title: "VLT Authentication Failed",
        message:
          "Authentication with VLT API failed. Your API token may be invalid or expired.",
        suggestions: [
          "Check your VLT API token in the configuration file",
          "Re-authenticate by obtaining a new token from VLT dashboard",
          "Verify the token has not been revoked",
        ],
        docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/guide/vlt-integration.md",
      },
      [
        {
          type: "config_change",
          params: { setting: "vlt_api_token" },
          description: "Update VLT API token in configuration",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Token expired (401 with specific message)
  if (
    message.includes("expired") ||
    message.includes("jwt") ||
    message.includes("token")
  ) {
    return createUserError(
      ERROR_CODES.VLT_TOKEN_EXPIRED,
      ErrorCategory.VLT,
      "error",
      true,
      {
        title: "VLT Token Expired",
        message:
          "Your VLT API token has expired. Please obtain a new token from the VLT dashboard.",
        suggestions: [
          "Log into VLT dashboard to generate a new API token",
          "Update the token in BillClaw configuration",
          "Tokens typically expire after a period of time for security",
        ],
        docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/guide/vlt-integration.md",
      },
      [
        {
          type: "config_change",
          params: { setting: "vlt_api_token" },
          description: "Update VLT API token",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Rate limited (429)
  if (statusCode === 429 || message.includes("429") || message.includes("rate limit")) {
    return createUserError(
      ERROR_CODES.VLT_RATE_LIMITED,
      ErrorCategory.VLT,
      "warning",
      true,
      {
        title: "VLT Rate Limit Exceeded",
        message:
          "Too many requests to VLT API. You have exceeded the rate limit.",
        suggestions: [
          "Wait a few minutes before retrying",
          "Reduce upload frequency if possible",
          "Check VLT plan limits if consistent uploads are needed",
        ],
        docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/guide/vlt-integration.md",
      },
      [
        {
          type: "retry",
          delayMs: 60000,
          description: "Retry after 1 minute",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Server error (5xx)
  if (
    statusCode >= 500 ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  ) {
    return createUserError(
      ERROR_CODES.VLT_API_ERROR,
      ErrorCategory.VLT,
      "warning",
      true,
      {
        title: "VLT API Error",
        message:
          "The VLT API encountered an internal error. Please try again later.",
        suggestions: [
          "Wait a few minutes and try again",
          "Check VLT service status if the issue persists",
          "Contact VLT support if errors continue",
        ],
        docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/guide/vlt-integration.md",
      },
      [
        {
          type: "retry",
          delayMs: 30000,
          description: "Retry after 30 seconds",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Connection failed
  if (
    message.includes("ECONNREFUSED") ||
    message.includes("network") ||
    message.includes("connection")
  ) {
    return createUserError(
      ERROR_CODES.VLT_CONNECTION_FAILED,
      ErrorCategory.NETWORK,
      "error",
      true,
      {
        title: "VLT Connection Failed",
        message:
          "Could not connect to VLT API. Please check your network connection.",
        suggestions: [
          "Verify your internet connection is working",
          "Check if VLT service is accessible",
          "Try again in a few moments",
        ],
      },
      [
        {
          type: "retry",
          delayMs: 10000,
          description: "Retry after 10 seconds",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Invalid region
  if (message.includes("region") || message.includes("invalid")) {
    return createUserError(
      ERROR_CODES.VLT_REGION_INVALID,
      ErrorCategory.CONFIG,
      "error",
      true,
      {
        title: "VLT Region Invalid",
        message:
          "The configured VLT region is not valid. Valid regions are: cn, us, eu-core, de.",
        suggestions: [
          "Check the region setting in configuration",
          "Valid regions: cn, us, eu-core, de",
          "Update to a valid region",
        ],
        docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/guide/vlt-integration.md",
      },
      [
        {
          type: "config_change",
          params: { setting: "vlt_region" },
          description: "Update VLT region configuration",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Generic upload failed
  if (message.includes("upload") || message.includes("failed")) {
    return createUserError(
      ERROR_CODES.VLT_UPLOAD_FAILED,
      ErrorCategory.VLT,
      "error",
      true,
      {
        title: "VLT Upload Failed",
        message:
          "Failed to upload transactions to VLT. Local data has been preserved.",
        suggestions: [
          "Check your network connection",
          "Verify VLT API token is valid",
          "Try uploading again later",
          "Your transactions are safely stored locally",
        ],
        docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/guide/vlt-integration.md",
      },
      [
        {
          type: "retry",
          delayMs: 30000,
          description: "Retry upload after 30 seconds",
        },
      ],
      entities,
      error instanceof Error ? error : undefined,
    )
  }

  // Generic VLT error
  return createUserError(
    ERROR_CODES.VLT_API_ERROR,
    ErrorCategory.VLT,
    "error",
    true,
    {
      title: "VLT API Error",
      message: `An error occurred while communicating with VLT: ${message}`,
      suggestions: [
        "Check your network connection",
        "Verify VLT configuration is correct",
        "Try again later",
      ],
      docsLink: "https://github.com/fire-la/firela-bot/blob/main/docs/guide/vlt-integration.md",
    },
    [
      {
        type: "retry",
        delayMs: 30000,
        description: "Retry after 30 seconds",
      },
    ],
    entities,
    error instanceof Error ? error : undefined,
  )
}

/**
 * Get troubleshooting guide URL for error category
 */
export function getTroubleshootingUrl(category: ErrorCategory): string {
  const baseUrl =
    "https://github.com/fire-la/firela-bot/blob/main/docs/troubleshooting.md"
  const urls: Partial<Record<ErrorCategory, string>> = {
    [ErrorCategory.CONFIG]: `${baseUrl}#configuration-issues`,
    [ErrorCategory.CREDENTIALS]: `${baseUrl}#credentials--authentication`,
    [ErrorCategory.NETWORK]: `${baseUrl}#network-issues`,
    [ErrorCategory.PLAID_API]: `${baseUrl}#plaid-integration`,
    [ErrorCategory.PLAID_AUTH]: `${baseUrl}#credentials--authentication`,
    [ErrorCategory.PLAID_ITEM]: `${baseUrl}#plaid-integration`,
    [ErrorCategory.GMAIL_API]: `${baseUrl}#gmail-integration`,
    [ErrorCategory.GMAIL_AUTH]: `${baseUrl}#credentials--authentication`,
    [ErrorCategory.STORAGE]: `${baseUrl}#storage-issues`,
    [ErrorCategory.FILE_SYSTEM]: `${baseUrl}#storage-issues`,
    [ErrorCategory.WEBHOOK]: `${baseUrl}#webhook-issues`,
    [ErrorCategory.VLT]: `${baseUrl}#vlt-integration`,
  }

  return urls[category] || baseUrl
}
