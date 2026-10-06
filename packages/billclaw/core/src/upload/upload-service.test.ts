/**
 * Tests for Upload Service
 *
 * Orchestrates the upload flow from BillClaw transactions to VLT.
 * Handles loading, transformation, upload, and status tracking.
 *
 * On upload failure, local data is always preserved
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { UploadService } from "./upload-service.js"
import type { VltConfig, StorageConfig } from "../models/config.js"
import type { Logger } from "../errors/errors.js"
import {
  createCredentialStore,
  CredentialStrategy,
  type CredentialStore,
} from "../credentials/store.js"
import { getStorageDir } from "../storage/transaction-storage.js"
import { uploadTransactions } from "./vlt-client.js"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// Passthrough-test seams (vlt #1518): the sync flow's side effects are
// mocked at the module boundary so the test can observe the ProviderSyncConfig
// the service builds from VltUploadConfig.
vi.mock("../storage/transaction-storage.js", () => ({
  getStorageDir: vi.fn(),
}))
vi.mock("./transform.js", () => ({
  transformTransactionsToPlaidFormat: vi.fn(() => [
    {
      transaction_id: "txn-1",
      amount: 1,
      iso_currency_code: "USD",
      date: "2024-01-15",
      name: "T",
      pending: false,
      account_id: "acc-1",
    },
  ]),
}))
vi.mock("./vlt-auth.js", () => ({
  VltAuthManager: class {
    ensureValidToken = vi.fn().mockResolvedValue("jwt-test")
    startBackgroundRefresh() {}
    stopBackgroundRefresh() {}
  },
}))
vi.mock("./vlt-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vlt-client.js")>()
  return {
    ...actual,
    uploadTransactions: vi
      .fn()
      .mockResolvedValue({ imported: 1, skipped: 0, pendingReview: 0, failed: 0 }),
  }
})

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock logger
const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}

// Mock config
const vltConfig: VltConfig = {
  apiUrl: "http://localhost:3000/api/v1",
  accessToken: "test-access-token",
  region: "us",
  upload: {
    mode: "auto",
    sourceAccount: "Assets:Bank",
    defaultCurrency: "USD",
    defaultExpenseAccount: "Expenses:Unknown",
    defaultIncomeAccount: "Income:Unknown",
    filterPending: true,
  },
}

const storageConfig: StorageConfig | undefined = undefined

describe("UploadService", () => {
  let mockCredentialStore: CredentialStore

  beforeEach(async () => {
    mockCredentialStore = await createCredentialStore({
      strategy: CredentialStrategy.MEMORY,
      logger: mockLogger,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("shouldUpload", () => {
    let service: UploadService

    beforeEach(() => {
      service = new UploadService(
        vltConfig,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )
    })

    it("should return true when configured with auto mode", async () => {
      const result = await service.shouldUpload()
      expect(result).toBe(true)
    })

    it("should return false when accessToken is missing", async () => {
      const configWithoutToken = {
        ...vltConfig,
        accessToken: undefined,
      } as VltConfig
      const serviceWithoutToken = new UploadService(
        configWithoutToken,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )

      const result = await serviceWithoutToken.shouldUpload()
      expect(result).toBe(false)
    })

    it("should return false when upload config is missing", async () => {
      const configWithoutUpload = { ...vltConfig }
      configWithoutUpload.upload = undefined
      const serviceWithoutUpload = new UploadService(
        configWithoutUpload,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )

      const result = await serviceWithoutUpload.shouldUpload()
      expect(result).toBe(false)
    })

    it("should return false when mode is disabled", async () => {
      const configDisabled = { ...vltConfig }
      configDisabled.upload!.mode = "disabled"
      const serviceDisabled = new UploadService(
        configDisabled,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )

      const result = await serviceDisabled.shouldUpload()
      expect(result).toBe(false)
    })
  })

  describe("uploadAccountTransactions", () => {
    let _service: UploadService

    beforeEach(() => {
      _service = new UploadService(
        vltConfig,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )
    })

    it("should throw when accessToken is missing", async () => {
      const configWithoutToken = {
        ...vltConfig,
        accessToken: undefined,
      } as VltConfig
      const serviceWithoutToken = new UploadService(
        configWithoutToken,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )

      const error = await serviceWithoutToken
        .uploadAccountTransactions("acc-1")
        .catch((e) => e)

      expect(error.type).toBe("UserError")
      expect(error.humanReadable.title).toBe("Firela VLT Not Configured")
      expect(error.humanReadable.message).toContain("access token is not configured")
    })

    it("should throw when upload config is missing", async () => {
      const configWithoutUpload = { ...vltConfig }
      configWithoutUpload.upload = undefined
      const serviceWithoutUpload = new UploadService(
        configWithoutUpload,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )

      const error = await serviceWithoutUpload
        .uploadAccountTransactions("acc-1")
        .catch((e) => e)

      expect(error.type).toBe("UserError")
      expect(error.humanReadable.title).toBe("Firela VLT Upload Not Configured")
      expect(error.humanReadable.message).toContain("upload configuration is missing")
    })
  })

  describe("skipPayeeMatch passthrough (vlt #1518)", () => {
    it("forwards the opt-in flag into the ProviderSyncConfig", async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "billclaw-passthrough-"))
      await vi.mocked(getStorageDir).mockResolvedValue(tmp)
      // Real storage layout: transactions/<accountId>/<year>/<month>.json.
      await fs.mkdir(path.join(tmp, "transactions", "acc-1", "2024"), {
        recursive: true,
      })
      await fs.writeFile(
        path.join(tmp, "transactions", "acc-1", "2024", "01.json"),
        JSON.stringify([{ date: "2024-01-15", amount: 1 }]),
        "utf-8",
      )

      const enabled: VltConfig = {
        ...vltConfig,
        upload: { ...vltConfig.upload, skipPayeeMatch: true },
      }
      const service = new UploadService(
        enabled,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )
      const result = await service.uploadAccountTransactions("acc-1", { days: 0 })
      expect(result.success).toBe(true)
      expect(uploadTransactions).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ skipPayeeMatch: true }),
        expect.anything(),
      )

      // Default (flag absent from config): the sync config carries no enabled
      // value and VltClient omits the field from the wire.
      const defaultService = new UploadService(
        vltConfig,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )
      const calls = vi.mocked(uploadTransactions).mock.calls
      const priorCalls = calls.length
      const defaultResult = await defaultService.uploadAccountTransactions(
        "acc-1",
        { days: 0 },
      )
      expect(defaultResult.success).toBe(true)
      const syncArg = vi.mocked(uploadTransactions).mock.calls[priorCalls][2]
      expect(syncArg.skipPayeeMatch).toBeUndefined()
    })
  })

  describe("getUploadStatus", () => {
    let service: UploadService

    beforeEach(() => {
      service = new UploadService(
        vltConfig,
        storageConfig,
        mockCredentialStore,
        mockLogger,
      )
    })

    it("should return null when no status file exists", async () => {
      const status = await service.getUploadStatus("nonexistent")
      expect(status).toBeNull()
    })
  })
})
