/**
 * Tests for Billclaw main class
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Billclaw } from "./index"
import type { RuntimeContext } from "./runtime/index"
import type { BillclawConfig, AccountConfig } from "./models"

// Mock runtime context
class MockLogger {
  info = vi.fn()
  error = vi.fn()
  warn = vi.fn()
  debug = vi.fn()
}

class MockConfigProvider {
  private config: BillclawConfig = {
    accounts: [],
    webhooks: [],
    storage: {
      path: "~/.firela/billclaw",
      format: "json",
      encryption: { enabled: false },
    },
    sync: {
      defaultFrequency: "daily",
      maxRetries: 3,
      retryOnFailure: true,
    },
    plaid: {
      environment: "sandbox",
    },
  }

  async getConfig(): Promise<BillclawConfig> {
    return this.config
  }

  async getStorageConfig() {
    return this.config.storage
  }

  async updateAccount(
    accountId: string,
    updates: Partial<AccountConfig>,
  ): Promise<void> {
    const index = this.config.accounts.findIndex((a) => a.id === accountId)
    if (index !== -1) {
      this.config.accounts[index] = {
        ...this.config.accounts[index],
        ...updates,
      }
    }
  }

  async getAccount(accountId: string): Promise<AccountConfig | null> {
    return this.config.accounts.find((a) => a.id === accountId) || null
  }

  setConfig(config: BillclawConfig) {
    this.config = config
  }
}

class MockEventEmitter {
  private listeners = new Map<string, Set<Function>>()

  emit(event: string, data?: unknown): void {
    const handlers = this.listeners.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data)
        } catch {
          // Ignore errors
        }
      }
    }
  }

  on(event: string, handler: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
  }

  off(event: string, handler: Function): void {
    const handlers = this.listeners.get(event)
    if (handlers) {
      handlers.delete(handler)
    }
  }
}

// Mock GoCardless adapter factory
vi.mock("./sources/gocardless/gocardless-adapter.js", () => ({
  createGoCardlessAdapter: vi.fn(),
}))

// Mock ProviderError for token_not_found tests
vi.mock("./relay/errors.js", () => ({
  ProviderError: class ProviderError extends Error {
    provider: string
    code: string
    constructor(provider: string, code: string, message: string) {
      super(message)
      this.name = "ProviderError"
      this.provider = provider
      this.code = code
    }
  },
}))

// Mock storage functions (file I/O)
vi.mock("./storage/transaction-storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./storage/transaction-storage.js")>()
  return {
    ...actual,
    appendTransactions: vi.fn().mockResolvedValue({ added: 0, updated: 0 }),
    deduplicateTransactions: vi.fn((txns) => txns),
    writeSyncState: vi.fn().mockResolvedValue(undefined),
    readSyncStates: vi.fn().mockResolvedValue([]),
  }
})

// Mock relay error parsers
vi.mock("./relay/index.js", () => ({
  parseGoCardlessRelayError: vi.fn(),
  parsePlaidRelayError: vi.fn(),
}))

// Mock Plaid adapter factory for error parsing tests
vi.mock("./sources/plaid/plaid-adapter.js", () => ({
  createPlaidAdapter: vi.fn(),
  DirectPlaidClient: vi.fn(),
}))

describe("Billclaw", () => {
  let tempDir: string
  let mockContext: RuntimeContext
  let mockConfig: MockConfigProvider
  let billclaw: Billclaw

  beforeEach(async () => {
    vi.clearAllMocks()

    // Create temp directory (mkdtemp: unique per creation - Date.now() names
    // collide across parallel test files, #64)
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "billclaw-test-"))

    const mockLogger = new MockLogger()
    mockConfig = new MockConfigProvider()
    const mockEvents = new MockEventEmitter()

    mockContext = {
      logger: mockLogger as any,
      config: mockConfig as any,
      events: mockEvents as any,
    }

    // Update config to use temp directory
    mockConfig.setConfig({
      ...(await mockConfig.getConfig()),
      storage: {
        path: tempDir,
        format: "json",
        encryption: { enabled: false },
      },
    })

    billclaw = new Billclaw(mockContext)
  })

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("constructor", () => {
    it("should create instance with runtime context", () => {
      expect(billclaw).toBeInstanceOf(Billclaw)
    })

    it("should initialize storage", () => {
      expect(billclaw).toBeDefined()
    })
  })

  describe("getAccounts", () => {
    it("should return empty array when no accounts", async () => {
      const accounts = await billclaw.getAccounts()
      expect(accounts).toEqual([])
    })

    it("should return configured accounts", async () => {
      const testAccount: AccountConfig = {
        id: "test-1",
        type: "plaid",
        name: "Test Account",
        enabled: true,
        syncFrequency: "daily",
      }

      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const accounts = await billclaw.getAccounts()
      expect(accounts).toHaveLength(1)
      expect(accounts[0]).toEqual(testAccount)
    })
  })

  describe("getTransactions", () => {
    beforeEach(async () => {
      // Add test account
      const testAccount: AccountConfig = {
        id: "acct-1",
        type: "plaid",
        name: "Test Account",
        enabled: true,
        syncFrequency: "daily",
      }

      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })
    })

    it("should return transactions for account and period", async () => {
      // This test would require actual storage to be working
      // For now, we test the method signature
      const transactions = await billclaw.getTransactions("acct-1", 2024, 1)
      expect(Array.isArray(transactions)).toBe(true)
    })

    it("should return all transactions when account is 'all'", async () => {
      const transactions = await billclaw.getTransactions("all", 2024, 1)
      expect(Array.isArray(transactions)).toBe(true)
    })
  })

  describe("exportToBeancount", () => {
    it("should export transactions to Beancount format", async () => {
      const exportResult = await billclaw.exportToBeancount("acct-1", 2024, 1)

      expect(typeof exportResult).toBe("string")
      expect(exportResult).toContain("Beancount")
    })
  })

  describe("exportToLedger", () => {
    it("should export transactions to Ledger format", async () => {
      const exportResult = await billclaw.exportToLedger("acct-1", 2024, 1)

      expect(typeof exportResult).toBe("string")
    })
  })

  describe("events", () => {
    it("should emit events through event emitter", async () => {
      const mockEvents = mockContext.events as MockEventEmitter
      let eventReceived = false

      mockEvents.on("test.event", () => {
        eventReceived = true
      })

      mockEvents.emit("test.event")

      expect(eventReceived).toBe(true)
    })
  })

  describe("syncAccount - gocardless", () => {
    it("handles happy path with access token", async () => {
      const { createGoCardlessAdapter } = await import("./sources/gocardless/gocardless-adapter.js")
      const { appendTransactions, deduplicateTransactions, writeSyncState } = await import("./storage/transaction-storage.js")

      const mockAdapter = {
        getAccounts: vi.fn().mockResolvedValue([{ id: "gc-acc-1" }]),
        getTransactions: vi.fn().mockResolvedValue({
          transactions: {
            booked: [
              {
                transactionId: "gc-txn-1",
                bookingDate: "2026-03-15",
                valueDate: "2026-03-15",
                transactionAmount: { amount: "-50.25", currency: "EUR" },
                remittanceInformationUnstructured: "SUPERMARKET",
              },
            ],
            pending: [],
          },
        }),
        getMode: vi.fn().mockReturnValue("relay"),
        ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
      }
      vi.mocked(createGoCardlessAdapter).mockResolvedValue(mockAdapter as any)
      vi.mocked(appendTransactions).mockResolvedValue({ added: 1, updated: 0 })
      vi.mocked(deduplicateTransactions).mockImplementation((txns: any) => txns)

      const testAccount: AccountConfig = {
        id: "gocardless-1",
        type: "gocardless",
        name: "GoCardless Account",
        enabled: true,
        syncFrequency: "daily",
        gocardlessAccessToken: "test-access-token",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const result = await billclaw.syncAccount("gocardless-1")

      expect(result.success).toBe(true)
      expect(result.transactionsAdded).toBeGreaterThan(0)
      expect(result.accountId).toBe("gocardless-1")
      expect(mockAdapter.ensureValidToken).toHaveBeenCalledWith("gocardless-1")
      expect(createGoCardlessAdapter).toHaveBeenCalled()
      expect(appendTransactions).toHaveBeenCalled()
      expect(writeSyncState).toHaveBeenCalled()
    })

    it("auto-refreshes expired token during sync", async () => {
      const { createGoCardlessAdapter } = await import("./sources/gocardless/gocardless-adapter.js")
      const { appendTransactions, deduplicateTransactions } = await import("./storage/transaction-storage.js")

      const mockAdapter = {
        getAccounts: vi.fn().mockResolvedValue([{ id: "gc-acc-1" }]),
        getTransactions: vi.fn().mockResolvedValue({
          transactions: { booked: [], pending: [] },
        }),
        getMode: vi.fn().mockReturnValue("relay"),
        ensureValidToken: vi.fn().mockResolvedValue("refreshed-access-token"),
      }
      vi.mocked(createGoCardlessAdapter).mockResolvedValue(mockAdapter as any)
      vi.mocked(appendTransactions).mockResolvedValue({ added: 0, updated: 0 })
      vi.mocked(deduplicateTransactions).mockImplementation((txns: any) => txns)

      const testAccount: AccountConfig = {
        id: "gocardless-1",
        type: "gocardless",
        name: "GoCardless Account",
        enabled: true,
        syncFrequency: "daily",
        gocardlessAccessToken: "stale-token",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const result = await billclaw.syncAccount("gocardless-1")

      expect(result.success).toBe(true)
      expect(mockAdapter.ensureValidToken).toHaveBeenCalledWith("gocardless-1")
      // Verify getAccounts receives refreshed token, NOT the stale config token
      expect(mockAdapter.getAccounts).toHaveBeenCalledWith("refreshed-access-token")
      expect(mockAdapter.getTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ access_token: "refreshed-access-token" }),
      )
    })

    it("returns actionable error when token not found in storage", async () => {
      const { createGoCardlessAdapter } = await import("./sources/gocardless/gocardless-adapter.js")
      const { ProviderError } = await import("./relay/errors.js")

      const mockAdapter = {
        getAccounts: vi.fn(),
        getTransactions: vi.fn(),
        getMode: vi.fn().mockReturnValue("relay"),
        ensureValidToken: vi.fn().mockRejectedValue(
          new ProviderError("gocardless", "token_not_found", "No token found for account"),
        ),
      }
      vi.mocked(createGoCardlessAdapter).mockResolvedValue(mockAdapter as any)

      const testAccount: AccountConfig = {
        id: "gocardless-no-token",
        type: "gocardless",
        name: "GoCardless No Token",
        enabled: true,
        syncFrequency: "daily",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const result = await billclaw.syncAccount("gocardless-no-token")

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors![0].humanReadable.message).toContain("re-connect")
    })

    it("does not read account.gocardlessAccessToken from config", async () => {
      const { createGoCardlessAdapter } = await import("./sources/gocardless/gocardless-adapter.js")
      const { appendTransactions, deduplicateTransactions } = await import("./storage/transaction-storage.js")

      const mockAdapter = {
        getAccounts: vi.fn().mockResolvedValue([{ id: "gc-acc-1" }]),
        getTransactions: vi.fn().mockResolvedValue({
          transactions: { booked: [], pending: [] },
        }),
        getMode: vi.fn().mockReturnValue("relay"),
        ensureValidToken: vi.fn().mockResolvedValue("from-storage-token"),
      }
      vi.mocked(createGoCardlessAdapter).mockResolvedValue(mockAdapter as any)
      vi.mocked(appendTransactions).mockResolvedValue({ added: 0, updated: 0 })
      vi.mocked(deduplicateTransactions).mockImplementation((txns: any) => txns)

      const testAccount: AccountConfig = {
        id: "gocardless-1",
        type: "gocardless",
        name: "GoCardless Account",
        enabled: true,
        syncFrequency: "daily",
        gocardlessAccessToken: "should-not-be-used",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const result = await billclaw.syncAccount("gocardless-1")

      expect(result.success).toBe(true)
      // Verify getAccounts receives token from ensureValidToken, NOT from config
      expect(mockAdapter.getAccounts).toHaveBeenCalledWith("from-storage-token")
      expect(mockAdapter.getAccounts).not.toHaveBeenCalledWith("should-not-be-used")
    })

    it("returns error when adapter throws", async () => {
      const { createGoCardlessAdapter } = await import("./sources/gocardless/gocardless-adapter.js")
      const { parseGoCardlessRelayError } = await import("./relay/index.js")

      vi.mocked(createGoCardlessAdapter).mockRejectedValue(new Error("Relay unavailable"))
      vi.mocked(parseGoCardlessRelayError).mockReturnValue({
        errorCode: "UNKNOWN_ERROR",
        category: "network",
        severity: "error",
        retryable: true,
        humanReadable: {
          title: "Sync Failed",
          message: "Relay unavailable",
          suggestions: [],
        },
        actions: [],
        context: {},
      } as any)

      const testAccount: AccountConfig = {
        id: "gocardless-err",
        type: "gocardless",
        name: "GoCardless Error",
        enabled: true,
        syncFrequency: "daily",
        gocardlessAccessToken: "test-token",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const result = await billclaw.syncAccount("gocardless-err")

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
    })

    it("uses parseGoCardlessRelayError for relay-specific error messages", async () => {
      const { createGoCardlessAdapter } = await import("./sources/gocardless/gocardless-adapter.js")
      const { parseGoCardlessRelayError } = await import("./relay/index.js")

      const relayError = new Error("Token expired for account")
      const mockAdapter = {
        getAccounts: vi.fn().mockRejectedValue(relayError),
        getTransactions: vi.fn(),
        getMode: vi.fn().mockReturnValue("relay"),
        ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
      }
      vi.mocked(createGoCardlessAdapter).mockResolvedValue(mockAdapter as any)

      vi.mocked(parseGoCardlessRelayError).mockReturnValue({
        errorCode: "GOCARDLESS_RELAY_TOKEN_EXPIRED",
        category: "provider",
        severity: "error",
        retryable: false,
        humanReadable: {
          title: "GoCardless Token Expired",
          message: "Your GoCardless banking token has expired. Please re-connect your account.",
          suggestions: ["Run the connect command to re-authenticate"],
        },
        actions: [],
        context: { accountId: "gocardless-relay-err" },
      } as any)

      const testAccount: AccountConfig = {
        id: "gocardless-relay-err",
        type: "gocardless",
        name: "GoCardless Relay Error",
        enabled: true,
        syncFrequency: "daily",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const result = await billclaw.syncAccount("gocardless-relay-err")

      expect(result.success).toBe(false)
      expect(parseGoCardlessRelayError).toHaveBeenCalledWith(
        relayError,
        { accountId: "gocardless-relay-err" },
      )
      expect(result.errors![0].errorCode).toBe("GOCARDLESS_RELAY_TOKEN_EXPIRED")
      expect(result.errors![0].humanReadable.message).toContain("re-connect")
    })

    it("sets requiresReauth=true when parseGoCardlessRelayError returns GOCARDLESS_RELAY_TOKEN_EXPIRED", async () => {
      const { createGoCardlessAdapter } = await import("./sources/gocardless/gocardless-adapter.js")
      const { parseGoCardlessRelayError } = await import("./relay/index.js")

      const relayError = new Error("Token expired for account")
      const mockAdapter = {
        getAccounts: vi.fn().mockRejectedValue(relayError),
        getTransactions: vi.fn(),
        getMode: vi.fn().mockReturnValue("relay"),
        ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
      }
      vi.mocked(createGoCardlessAdapter).mockResolvedValue(mockAdapter as any)

      vi.mocked(parseGoCardlessRelayError).mockReturnValue({
        errorCode: "GOCARDLESS_RELAY_TOKEN_EXPIRED",
        category: "provider",
        severity: "error",
        retryable: false,
        humanReadable: {
          title: "GoCardless Token Expired",
          message: "Your GoCardless banking token has expired. Please re-connect your account.",
          suggestions: ["Run the connect command to re-authenticate"],
        },
        actions: [],
        context: { accountId: "gocardless-reauth-token" },
      } as any)

      const testAccount: AccountConfig = {
        id: "gocardless-reauth-token",
        type: "gocardless",
        name: "GoCardless Reauth Token",
        enabled: true,
        syncFrequency: "daily",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const result = await billclaw.syncAccount("gocardless-reauth-token")

      expect(result.success).toBe(false)
      expect(result.requiresReauth).toBe(true)
    })

    it("sets requiresReauth=true when parseGoCardlessRelayError returns GOCARDLESS_RELAY_REQUISITION_NOT_FOUND", async () => {
      const { createGoCardlessAdapter } = await import("./sources/gocardless/gocardless-adapter.js")
      const { parseGoCardlessRelayError } = await import("./relay/index.js")

      const relayError = new Error("Requisition not found")
      const mockAdapter = {
        getAccounts: vi.fn().mockRejectedValue(relayError),
        getTransactions: vi.fn(),
        getMode: vi.fn().mockReturnValue("relay"),
        ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
      }
      vi.mocked(createGoCardlessAdapter).mockResolvedValue(mockAdapter as any)

      vi.mocked(parseGoCardlessRelayError).mockReturnValue({
        errorCode: "GOCARDLESS_RELAY_REQUISITION_NOT_FOUND",
        category: "provider",
        severity: "error",
        retryable: false,
        humanReadable: {
          title: "GoCardless Requisition Not Found",
          message: "Your GoCardless requisition was not found. Please re-connect your account.",
          suggestions: ["Run the connect command to create a new requisition"],
        },
        actions: [],
        context: { accountId: "gocardless-reauth-req" },
      } as any)

      const testAccount: AccountConfig = {
        id: "gocardless-reauth-req",
        type: "gocardless",
        name: "GoCardless Reauth Requisition",
        enabled: true,
        syncFrequency: "daily",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const result = await billclaw.syncAccount("gocardless-reauth-req")

      expect(result.success).toBe(false)
      expect(result.requiresReauth).toBe(true)
    })

    it("sets requiresReauth=false for non-reauth error codes like GOCARDLESS_RELAY_RATE_LIMITED", async () => {
      const { createGoCardlessAdapter } = await import("./sources/gocardless/gocardless-adapter.js")
      const { parseGoCardlessRelayError } = await import("./relay/index.js")

      const relayError = new Error("Rate limited")
      const mockAdapter = {
        getAccounts: vi.fn().mockRejectedValue(relayError),
        getTransactions: vi.fn(),
        getMode: vi.fn().mockReturnValue("relay"),
        ensureValidToken: vi.fn().mockResolvedValue("test-access-token"),
      }
      vi.mocked(createGoCardlessAdapter).mockResolvedValue(mockAdapter as any)

      vi.mocked(parseGoCardlessRelayError).mockReturnValue({
        errorCode: "GOCARDLESS_RELAY_RATE_LIMITED",
        category: "network",
        severity: "warning",
        retryable: true,
        humanReadable: {
          title: "Rate Limited",
          message: "Too many requests to GoCardless. Please try again later.",
          suggestions: ["Wait a few minutes and retry"],
        },
        actions: [],
        context: { accountId: "gocardless-rate-limited" },
      } as any)

      const testAccount: AccountConfig = {
        id: "gocardless-rate-limited",
        type: "gocardless",
        name: "GoCardless Rate Limited",
        enabled: true,
        syncFrequency: "daily",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const result = await billclaw.syncAccount("gocardless-rate-limited")

      expect(result.success).toBe(false)
      expect(result.requiresReauth).toBe(false)
    })
  })

  describe("syncPlaid - error parsing", () => {
    it("uses parsePlaidRelayError when adapter is in relay mode", async () => {
      const { createPlaidAdapter } = await import("./sources/plaid/plaid-adapter.js")
      const { parsePlaidRelayError } = await import("./relay/index.js")

      const relayError = new Error("Relay connection expired")
      const mockAdapter = {
        syncTransactions: vi.fn().mockRejectedValue(relayError),
        getMode: vi.fn().mockReturnValue("relay"),
      }
      vi.mocked(createPlaidAdapter).mockResolvedValue(mockAdapter as any)

      vi.mocked(parsePlaidRelayError).mockReturnValue({
        errorCode: "PLAID_RELAY_BANK_CONNECTION_EXPIRED",
        category: "provider",
        severity: "error",
        retryable: false,
        humanReadable: {
          title: "Bank Connection Expired",
          message: "Your bank connection via relay has expired. Please re-connect.",
          suggestions: ["Re-connect your account"],
        },
        actions: [],
        context: { accountId: "plaid-relay-1" },
      } as any)

      const testAccount: AccountConfig = {
        id: "plaid-relay-1",
        type: "plaid",
        name: "Plaid Relay Account",
        enabled: true,
        syncFrequency: "daily",
        plaidAccessToken: "test-plaid-token",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const results = await billclaw.syncPlaid(["plaid-relay-1"])
      const result = results[0]

      expect(result.success).toBe(false)
      expect(parsePlaidRelayError).toHaveBeenCalledWith(
        relayError,
        { accountId: "plaid-relay-1" },
      )
      expect(result.errors![0].errorCode).toBe("PLAID_RELAY_BANK_CONNECTION_EXPIRED")
    })

    it("uses parsePlaidError when adapter is in direct mode", async () => {
      const { createPlaidAdapter } = await import("./sources/plaid/plaid-adapter.js")
      const { parsePlaidRelayError } = await import("./relay/index.js")

      const plaidError = {
        error_code: "ITEM_LOGIN_REQUIRED",
        error_message: "the login details of this item have changed",
        error_type: "ITEM_ERROR",
      }
      const mockAdapter = {
        syncTransactions: vi.fn().mockRejectedValue(plaidError),
        getMode: vi.fn().mockReturnValue("direct"),
      }
      vi.mocked(createPlaidAdapter).mockResolvedValue(mockAdapter as any)

      const testAccount: AccountConfig = {
        id: "plaid-direct-1",
        type: "plaid",
        name: "Plaid Direct Account",
        enabled: true,
        syncFrequency: "daily",
        plaidAccessToken: "test-plaid-token",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const results = await billclaw.syncPlaid(["plaid-direct-1"])
      const result = results[0]

      expect(result.success).toBe(false)
      // parsePlaidRelayError should NOT be called in direct mode
      expect(parsePlaidRelayError).not.toHaveBeenCalled()
      // parsePlaidError (from errors.js) should have processed the error
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    it("sets requiresReauth=true for relay PLAID_RELAY_BANK_CONNECTION_EXPIRED", async () => {
      const { createPlaidAdapter } = await import("./sources/plaid/plaid-adapter.js")
      const { parsePlaidRelayError } = await import("./relay/index.js")

      const relayError = new Error("Bank connection expired")
      const mockAdapter = {
        syncTransactions: vi.fn().mockRejectedValue(relayError),
        getMode: vi.fn().mockReturnValue("relay"),
      }
      vi.mocked(createPlaidAdapter).mockResolvedValue(mockAdapter as any)

      vi.mocked(parsePlaidRelayError).mockReturnValue({
        errorCode: "PLAID_RELAY_BANK_CONNECTION_EXPIRED",
        category: "provider",
        severity: "error",
        retryable: false,
        humanReadable: {
          title: "Bank Connection Expired",
          message: "Your bank connection has expired. Please re-connect.",
          suggestions: ["Re-connect your account"],
        },
        actions: [],
        context: { accountId: "plaid-relay-reauth" },
      } as any)

      const testAccount: AccountConfig = {
        id: "plaid-relay-reauth",
        type: "plaid",
        name: "Plaid Relay Reauth",
        enabled: true,
        syncFrequency: "daily",
        plaidAccessToken: "test-plaid-token",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const results = await billclaw.syncPlaid(["plaid-relay-reauth"])
      const result = results[0]

      expect(result.success).toBe(false)
      expect(result.requiresReauth).toBe(true)
    })

    it("sets requiresReauth=true for direct mode PLAID_ITEM_LOGIN_REQUIRED", async () => {
      const { createPlaidAdapter } = await import("./sources/plaid/plaid-adapter.js")
      const { parsePlaidRelayError } = await import("./relay/index.js")

      const plaidError = {
        error_code: "ITEM_LOGIN_REQUIRED",
        error_message: "the login details of this item have changed",
        error_type: "ITEM_ERROR",
      }
      const mockAdapter = {
        syncTransactions: vi.fn().mockRejectedValue(plaidError),
        getMode: vi.fn().mockReturnValue("direct"),
      }
      vi.mocked(createPlaidAdapter).mockResolvedValue(mockAdapter as any)

      const testAccount: AccountConfig = {
        id: "plaid-direct-reauth",
        type: "plaid",
        name: "Plaid Direct Reauth",
        enabled: true,
        syncFrequency: "daily",
        plaidAccessToken: "test-plaid-token",
      }
      mockConfig.setConfig({
        ...(await mockConfig.getConfig()),
        accounts: [testAccount],
      })

      const results = await billclaw.syncPlaid(["plaid-direct-reauth"])
      const result = results[0]

      expect(result.success).toBe(false)
      expect(parsePlaidRelayError).not.toHaveBeenCalled()
      expect(result.requiresReauth).toBe(true)
    })
  })
})
