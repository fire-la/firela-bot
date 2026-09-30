/**
 * Upload module for BillClaw - Transaction upload to Firela VLT Beancount SaaS
 *
 * Provides:
 * - VLT API client with retry logic
 * - Transaction transformation (BillClaw -> Plaid format)
 * - Upload status tracking
 * - Upload service for orchestrating the upload flow
 * - Automatic JWT token management (VltAuthManager)
 *
 * @packageDocumentation
 */

// VLT API client
export {
  VltClient,
  uploadTransactions,
  checkUploadResult,
  type VltClientConfig,
  type PlaidTransactionUpload,
  type ProviderSyncConfig,
  type VltUploadResult,
} from "./vlt-client.js"

// Transaction transformation
export {
  transformToPlaidFormat,
  transformTransactionsToPlaidFormat,
} from "./transform.js"

// Upload status tracking
export {
  UploadStatusStore,
  type VltUploadStatus,
} from "./upload-status.js"

// Upload service
export {
  UploadService,
  type UploadServiceResult,
  type UploadOptions,
} from "./upload-service.js"

// VLT Authentication Manager
export {
  VltAuthManager,
  type VltAuthManagerConfig,
} from "./vlt-auth.js"
