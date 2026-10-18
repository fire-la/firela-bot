/**
 * Tests for transaction storage
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  getStorageDir,
  initializeStorage,
  readTransactions,
  writeTransactions,
  deduplicateTransactions,
  type Transaction,
  type StorageConfig,
} from "./transaction-storage"

// Mock logger
const _mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}

describe("getStorageDir", () => {
  it("should return default storage directory", async () => {
    const dir = await getStorageDir()
    expect(dir).toContain(".firela")
  })

  it("should return custom storage directory from config", async () => {
    const config: StorageConfig = {
      path: "/custom/path",
      format: "json",
      encryption: { enabled: false },
    }
    const dir = await getStorageDir(config)
    expect(dir).toContain("custom/path")
  })
})

describe("initializeStorage", () => {
  let tempDir: string

  beforeEach(async () => {
    // mkdtemp: unique per creation - a Date.now() name collides across
    // parallel test files, and one file's afterEach rm -rf then deletes
    // another file's active dir (#64)
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "billclaw-test-"))
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  })

  it("should create storage directory structure", async () => {
    const config: StorageConfig = {
      path: tempDir,
      format: "json",
      encryption: { enabled: false },
    }

    await initializeStorage(config)

    const transactionsDir = path.join(tempDir, "transactions")
    const accountsDir = path.join(tempDir, "accounts")
    const syncDir = path.join(tempDir, "sync")

    expect(
      await fs
        .access(transactionsDir)
        .then(() => true)
        .catch(() => false),
    ).toBe(true)
    expect(
      await fs
        .access(accountsDir)
        .then(() => true)
        .catch(() => false),
    ).toBe(true)
    expect(
      await fs
        .access(syncDir)
        .then(() => true)
        .catch(() => false),
    ).toBe(true)
  })
})

describe("deduplicateTransactions", () => {
  it("should remove duplicate transactions based on plaidTransactionId", () => {
    const tx1: Transaction = {
      transactionId: "plaid-1",
      accountId: "acct-1",
      date: "2024-01-15",
      amount: 100,
      currency: "USD",
      category: ["Food"],
      merchantName: "Test",
      paymentChannel: "online",
      pending: false,
      plaidTransactionId: "plaid-1",
      createdAt: "2024-01-15T10:00:00Z",
    }

    const tx2: Transaction = {
      ...tx1,
      createdAt: "2024-01-15T11:00:00Z",
    }

    const tx3: Transaction = {
      transactionId: "plaid-2",
      accountId: "acct-1",
      date: "2024-01-16",
      amount: 50,
      currency: "USD",
      category: ["Shopping"],
      merchantName: "Store",
      paymentChannel: "in store",
      pending: false,
      plaidTransactionId: "plaid-2",
      createdAt: "2024-01-16T10:00:00Z",
    }

    const result = deduplicateTransactions([tx1, tx2, tx3])

    expect(result).toHaveLength(2)
    expect(result[0].transactionId).toBe("plaid-1")
    expect(result[1].transactionId).toBe("plaid-2")
  })

  it("should handle empty array", () => {
    const result = deduplicateTransactions([])
    expect(result).toEqual([])
  })

  it("should preserve the last occurrence of duplicates", () => {
    const tx1: Transaction = {
      transactionId: "plaid-1",
      accountId: "acct-1",
      date: "2024-01-15",
      amount: 100,
      currency: "USD",
      category: ["Food"],
      merchantName: "Test",
      paymentChannel: "online",
      pending: false,
      plaidTransactionId: "plaid-1",
      createdAt: "2024-01-15T10:00:00Z",
    }

    const tx2: Transaction = {
      ...tx1,
      amount: 150, // Different amount
      createdAt: "2024-01-15T11:00:00Z",
    }

    const result = deduplicateTransactions([tx1, tx2])

    expect(result).toHaveLength(1)
    expect(result[0].amount).toBe(100) // Keeps the first occurrence
  })
})

describe("writeTransactions and readTransactions", () => {
  let tempDir: string
  let config: StorageConfig

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "billclaw-test-"))

    config = {
      path: tempDir,
      format: "json" as const,
      encryption: { enabled: false },
    }

    await initializeStorage(config)
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore
    }
  })

  it("should write and read transactions", async () => {
    const transactions: Transaction[] = [
      {
        transactionId: "plaid-1",
        accountId: "acct-1",
        date: "2024-01-15",
        amount: 10050,
        currency: "USD",
        category: ["Food", "Restaurants"],
        merchantName: "Test Restaurant",
        paymentChannel: "online",
        pending: false,
        plaidTransactionId: "plaid-1",
        createdAt: "2024-01-15T10:00:00Z",
      },
    ]

    await writeTransactions("acct-1", 2024, 1, transactions, config)
    const read = await readTransactions("acct-1", 2024, 1, config)

    expect(read).toHaveLength(1)
    expect(read[0].transactionId).toBe("plaid-1")
  })

  it("should create monthly transaction files", async () => {
    const transactions: Transaction[] = [
      {
        transactionId: "plaid-1",
        accountId: "acct-1",
        date: "2024-01-15",
        amount: 10050,
        currency: "USD",
        category: ["Food"],
        merchantName: "Test",
        paymentChannel: "online",
        pending: false,
        plaidTransactionId: "plaid-1",
        createdAt: "2024-01-15T10:00:00Z",
      },
    ]

    await writeTransactions("acct-1", 2024, 1, transactions, config)

    const expectedPath = path.join(
      tempDir,
      "transactions",
      "acct-1",
      "2024",
      "01.json",
    )

    const exists = await fs
      .access(expectedPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it("should return empty array for non-existent file", async () => {
    const read = await readTransactions("non-existent", 2024, 1, config)
    expect(read).toEqual([])
  })
})
