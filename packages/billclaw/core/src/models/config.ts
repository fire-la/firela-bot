/**
 * Zod schemas for BillClaw configuration
 *
 * This file contains Zod schemas for type-safe configuration validation.
 * These schemas are framework-agnostic and work across all adapters.
 */

import { z } from "zod"
import { InboundWebhookReceiverConfigSchema } from "../webhook/config.js"

/**
 * Unified connection mode for OAuth and webhooks
 *
 * This mode controls how BillClaw connects to external services for:
 * - OAuth flow completion (Plaid Link, Gmail authorization)
 * - Webhook reception (Plaid, GoCardless, Gmail notifications)
 *
 * @see ADR-006 for architecture details
 */
export const ConnectionModeSchema = z.enum([
  "auto", // Auto-detect optimal mode (Relay > Direct > Polling)
  "direct", // Force user's Connect service (requires publicUrl)
  "relay", // Force relay mode (requires relay.url and relay.apiKey)
  "polling", // Force API polling (webhooks only, not for OAuth)
])
export type ConnectionMode = z.infer<typeof ConnectionModeSchema>

/**
 * Connection mode selector configuration
 *
 * Controls both OAuth completion and webhook reception modes.
 * Unified configuration to simplify user mental model.
 */
export const ConnectionModeSelectorSchema = z.object({
  mode: ConnectionModeSchema.default("auto"),
  healthCheck: z
    .object({
      enabled: z.boolean().default(true),
      timeout: z.number().int().positive().default(5000),
      retries: z.number().int().min(0).max(5).default(2),
      retryDelay: z.number().int().positive().default(1000),
    })
    .default({}),
})
export type ConnectionModeSelector = z.infer<typeof ConnectionModeSelectorSchema>

/**
 * Relay service configuration for Open Banking without user-owned credentials
 *
 * When configured, BillClaw can use the firela-relay service to access
 * Plaid and GoCardless APIs without requiring users to have their own
 * provider accounts.
 */
export const RelayConfigSchema = z.object({
  /** Relay service base URL (e.g., https://relay.firela.io) */
  url: z.string().url().optional(),
  /** API key for Bearer token authentication */
  apiKey: z.string().optional(),
  /** Request timeout in milliseconds (default: 30000) */
  timeout: z.number().int().positive().default(30000),
  /** Maximum retry attempts (default: 3) */
  maxRetries: z.number().int().min(0).max(5).default(3),
})
export type RelayConfig = z.infer<typeof RelayConfigSchema>

/**
 * Account types supported by BillClaw
 */
export const AccountTypeSchema = z.enum(["plaid", "gocardless", "gmail"])
export type AccountType = z.infer<typeof AccountTypeSchema>

/**
 * Sync frequency options
 */
export const SyncFrequencySchema = z.enum([
  "realtime",
  "hourly",
  "daily",
  "weekly",
  "manual",
])
export type SyncFrequency = z.infer<typeof SyncFrequencySchema>

/**
 * Plaid environment options
 */
export const PlaidEnvironmentSchema = z.enum([
  "sandbox",
  "development",
  "production",
])
export type PlaidEnvironment = z.infer<typeof PlaidEnvironmentSchema>

/**
 * Webhook event types
 */
export const WebhookEventTypeSchema = z.enum([
  "transaction.new",
  "transaction.updated",
  "transaction.deleted",
  "sync.started",
  "sync.completed",
  "sync.failed",
  "account.connected",
  "account.disconnected",
  "account.error",
  "webhook.test",
])
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>

/**
 * Per-account configuration
 */
export const AccountConfigSchema = z.object({
  id: z.string().min(1),
  type: AccountTypeSchema,
  name: z.string().min(1),
  enabled: z.boolean().default(false),
  syncFrequency: SyncFrequencySchema.default("daily"),
  lastSync: z.string().optional(),
  lastStatus: z.enum(["success", "error", "pending"]).optional(),
  // Plaid-specific
  plaidItemId: z.string().optional(),
  plaidAccessToken: z.string().optional(),
  // GoCardless-specific
  gocardlessRequisitionId: z.string().optional(),
  gocardlessAccessToken: z.string().optional(),
  // Gmail-specific
  gmailEmailAddress: z.string().email().optional(),
  gmailAccessToken: z.string().optional(),
  /** @deprecated Gmail now uses relay-only mode; refresh tokens are managed by relay */
  gmailRefreshToken: z.string().optional(),
  gmailTokenExpiry: z.string().optional(), // ISO timestamp
  gmailFilters: z.array(z.string()).optional(),
})
export type AccountConfig = z.infer<typeof AccountConfigSchema>

/**
 * Webhook configuration
 */
export const WebhookConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().url().optional(),
  secret: z.string().optional(),
  retryPolicy: z
    .object({
      maxRetries: z.number().int().min(0).default(3),
      initialDelay: z.number().int().min(0).default(1000),
      maxDelay: z.number().int().min(0).default(30000),
    })
    .default({
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 30000,
    }),
  events: z
    .array(WebhookEventTypeSchema)
    .default(["transaction.new", "sync.failed", "account.error"]),
})
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>

/**
 * Storage configuration
 */
export const StorageConfigSchema = z.object({
  path: z.string().default("~/.firela/billclaw"),
  format: z.enum(["json", "csv", "both"]).default("json"),
  encryption: z
    .object({
      enabled: z.boolean().default(false),
      keyPath: z.string().optional(),
    })
    .default({
      enabled: false,
    }),
})
export type StorageConfig = z.infer<typeof StorageConfigSchema>

/**
 * Plaid configuration
 */
export const PlaidConfigSchema = z.object({
  clientId: z.string().optional(),
  secret: z.string().optional(),
  environment: PlaidEnvironmentSchema.default("sandbox"),
  webhookUrl: z.string().url().optional(),
})
export type PlaidConfig = z.infer<typeof PlaidConfigSchema>

/**
 * GoCardless configuration
 */
export const GoCardlessConfigSchema = z.object({
  accessToken: z.string().optional(),
  environment: z.enum(["sandbox", "live"]).default("sandbox"),
})
export type GoCardlessConfig = z.infer<typeof GoCardlessConfigSchema>

/**
 * VLT region options
 */
export const VltRegionSchema = z.enum(["cn", "us", "eu-core", "de"])
export type VltRegion = z.infer<typeof VltRegionSchema>

/**
 * VLT upload mode options
 */
export const VltUploadModeSchema = z.enum(["auto", "manual", "disabled"])
export type VltUploadMode = z.infer<typeof VltUploadModeSchema>

/**
 * VLT upload configuration
 */
export const VltUploadConfigSchema = z.object({
  mode: VltUploadModeSchema.default("manual"),
  sourceAccount: z.string().min(1),
  defaultCurrency: z.string().default("USD"),
  defaultExpenseAccount: z.string().default("Expenses:Unknown"),
  defaultIncomeAccount: z.string().default("Income:Unknown"),
  filterPending: z.boolean().default(true),
  /**
   * Skip the payee-match stage on upload (vlt #1518). Opt-in with NO
   * default: absent = the field is not sent on the wire and vlt keeps its
   * default payee-matching behavior.
   */
  skipPayeeMatch: z.boolean().optional(),
})
export type VltUploadConfig = z.infer<typeof VltUploadConfigSchema>

/**
 * Firela VLT integration configuration
 *
 * Allows BillClaw to upload transactions to the Firela VLT platform.
 *
 * Authentication flow:
 * 1. User gets accessToken from Firela VLT app
 * 2. accessToken is used to exchange for JWT token via /auth/sessions/anonymous
 * 3. JWT token is cached in keychain and auto-refreshed before expiry
 */
export const VltConfigSchema = z.object({
  apiUrl: z.string().url().default("https://ign-dev.firela.io/api/v1"),
  /**
   * Access token for authentication (obtained from Firela VLT app)
   *
   * This is used to exchange for a JWT token via the /auth/sessions/anonymous endpoint.
   * The JWT token is then cached in the system keychain and auto-refreshed.
   */
  accessToken: z.string().optional(),
  region: VltRegionSchema.default("us"),
  upload: VltUploadConfigSchema.optional(),
})
export type VltConfig = z.infer<typeof VltConfigSchema>

/**
 * Gmail configuration
 */
export const GmailConfigSchema = z.object({
  historyId: z.string().optional(),
  pubsubTopic: z.string().optional(),
  senderWhitelist: z.array(z.string()).default([]),
  keywords: z
    .array(z.string())
    .default(["invoice", "statement", "bill due", "receipt", "payment due"]),
  // Recognition rules
  confidenceThreshold: z.number().min(0).max(1).default(0.5),
  requireAmount: z.boolean().default(false),
  requireDate: z.boolean().default(false),
  // Custom bill type patterns
  billTypePatterns: z.record(z.array(z.string())).optional(),
})
export type GmailConfig = z.infer<typeof GmailConfigSchema>

/**
 * Connect service configuration
 */
export const ConnectConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(4456),
  host: z.string().default("localhost"),
  /**
   * Public URL for external access (required for production OAuth callbacks)
   *
   * Used for:
   * - Production OAuth callbacks (Plaid, Gmail)
   * - Direct mode webhook reception
   *
   * Examples:
   * - https://billclaw.yourdomain.com
   * - https://billclaw-ui.your-subdomain.workers.dev (Cloudflare Workers)
   *
   * If not set, defaults to http://localhost:{port} for local development.
   */
  publicUrl: z.string().url().optional(),
  /**
   * TLS/SSL configuration for HTTPS support
   */
  tls: z
    .object({
      enabled: z.boolean().default(false),
      keyPath: z.string().optional(),
      certPath: z.string().optional(),
    })
    .default({ enabled: false })
    .optional(),
  /**
   * Unified connection mode selector for OAuth and webhooks
   *
   * Controls both:
   * - OAuth flow completion (Plaid Link, Gmail authorization)
   * - Webhook reception (Plaid, GoCardless, Gmail notifications)
   *
   * Replaces the deprecated 'receiver' configuration with a simpler,
   * unified approach. Use this for new configurations.
   */
  connection: ConnectionModeSelectorSchema.optional(),
  /**
   * Inbound webhook receiver configuration (DEPRECATED)
   *
   * @deprecated Use 'connection' instead for unified OAuth + webhook control
   *
   * Unified webhook receiver supporting Direct/Polling modes for
   * receiving real-time notifications from external services (Plaid, GoCardless, Gmail).
   */
  receiver: InboundWebhookReceiverConfigSchema.optional(),
})
export type ConnectConfig = z.infer<typeof ConnectConfigSchema>

/**
 * Sync configuration
 */
export const SyncConfigSchema = z.object({
  defaultFrequency: SyncFrequencySchema.default("daily"),
  retryOnFailure: z.boolean().default(true),
  maxRetries: z.number().int().min(0).default(3),
})
export type SyncConfig = z.infer<typeof SyncConfigSchema>

/**
 * Export format options
 */
export const ExportFormatSchema = z.enum(["beancount", "ledger"])
export type ExportFormat = z.infer<typeof ExportFormatSchema>

/**
 * Export configuration
 */
export const ExportConfigSchema = z.object({
  format: ExportFormatSchema.default("beancount"),
  outputPath: z.string().default("~/.firela/billclaw/exports"),
  filePrefix: z.string().default("transactions"),
  includePending: z.boolean().default(false),
  currencyColumn: z.boolean().default(true),
})
export type ExportConfig = z.infer<typeof ExportConfigSchema>

/**
 * Main BillClaw configuration schema
 */
export const BillclawConfigSchema = z.object({
  version: z.number().default(1),
  accounts: z.array(AccountConfigSchema).default([]),
  webhooks: z.array(WebhookConfigSchema).default([]),
  storage: StorageConfigSchema.default({
    path: "~/.firela/billclaw",
    format: "json",
    encryption: { enabled: false },
  }),
  sync: SyncConfigSchema.default({
    defaultFrequency: "daily",
    retryOnFailure: true,
    maxRetries: 3,
  }),
  plaid: PlaidConfigSchema.default({
    environment: "sandbox",
  }),
  gocardless: GoCardlessConfigSchema.optional(),
  gmail: GmailConfigSchema.optional(),
  vlt: VltConfigSchema.optional(),
  /** Relay service configuration for Open Banking without user-owned credentials */
  relay: RelayConfigSchema.optional(),
  export: ExportConfigSchema.default({}),
  connect: ConnectConfigSchema.default({
    port: 4456,
    host: "localhost",
    receiver: undefined,
  }),
})
export type BillclawConfig = z.infer<typeof BillclawConfigSchema>
