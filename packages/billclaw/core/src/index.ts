/**
 * BillClaw Core - Framework-agnostic business logic for financial data import
 *
 * This package contains all core functionality with zero dependencies on any
 * AI framework (OpenClaw, OpenHands, etc.).
 *
 * @packageDocumentation
 */

// Main class
export { Billclaw, isTokenExpired } from "./billclaw.js"

// Models and schemas
export * from "./models/index.js"

// Storage
export * from "./storage/index.js"

// Sync
export * from "./sync/index.js"

// Data sources (note: some types may overlap with parsers)
export {
  syncPlaidAccounts,
  syncPlaidAccount,
  createPlaidClient,
  convertTransaction,
  type PlaidConfig,
  type PlaidAccount,
  type PlaidSyncResult,
} from "./sources/plaid/plaid-sync.js"

// Plaid adapter (dual mode: direct + relay)
export {
  createPlaidAdapter,
  type PlaidSyncAdapter,
} from "./sources/plaid/plaid-adapter.js"
export { DirectPlaidClient, RelayPlaidClient } from "./sources/plaid/plaid-adapter.js"

// GoCardless adapter (relay only)
export {
  createGoCardlessAdapter,
  type GoCardlessSyncAdapter,
} from "./sources/gocardless/gocardless-adapter.js"

// Gmail source
export {
  fetchGmailBills,
  fetchGmailEmails,
  recognizeBill,
  parseBillToTransaction,
  type GmailConfig,
  type GmailAccount,
  type GmailFetchResult,
  type GmailFetcherOptions,
  type EmailContent,
  type BillRecognition,
} from "./sources/gmail/gmail-fetch.js"

// Exporters
export {
  exportToBeancount,
  exportStorageToBeancount,
  transactionToBeancount,
  getBeancountAccountMappings,
  type BeancountExportOptions,
} from "./exporters/beancount.js"
export {
  exportToLedger,
  exportStorageToLedger,
  transactionToLedger,
  getLedgerAccountMappings,
  type LedgerExportOptions,
} from "./exporters/ledger.js"

// Errors
export * from "./errors/index.js"

// Credentials & Security
export * from "./credentials/index.js"
export * from "./security/index.js"

// OAuth (framework-agnostic)
export * from "./oauth/index.js"

// Runtime abstractions
export * from "./runtime/index.js"

// Configuration management
export * from "./config/index.js"

// Services (event emission, webhooks)
export * from "./services/index.js"

// Webhooks (inbound webhook processing)
export * from "./webhooks/index.js"

// Webhook receiver (configuration and mode selection)
export * from "./webhook/index.js"

// Connection mode selector (unified OAuth + webhook mode selection)
export * from "./connection/index.js"

// Upload (IGN Beancount SaaS integration)
export * from "./upload/index.js"

// Parsers (CSV file format detection and parsing)
