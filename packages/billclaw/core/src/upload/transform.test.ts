/**
 * Tests for transaction transformation
 */

import { describe, it, expect } from "vitest"
import {
  transformToPlaidFormat,
  transformTransactionsToPlaidFormat,
} from "./transform.js"
import type { Transaction } from "../storage/transaction-storage.js"

describe("transformToPlaidFormat", () => {
  it("should convert cents to dollars (1234 -> 12.34)", () => {
    const txn: Transaction = {
      transactionId: "txn-1",
      accountId: "acc-1",
      date: "2024-01-15",
      amount: 1234, // 1234 cents
      currency: "USD",
      category: ["Food", "Restaurants"],
      merchantName: "Test Restaurant",
      paymentChannel: "in_store",
      pending: false,
      plaidTransactionId: "plaid-1",
      createdAt: "2024-01-15T10:00:00Z",
    }

    const result = transformToPlaidFormat(txn)

    expect(result.amount).toBe(12.34) // 1234 / 100
  })

  it("should map all field names correctly", () => {
    const txn: Transaction = {
      transactionId: "txn-1",
      accountId: "acc-1",
      date: "2024-01-15",
      amount: 5000, // 50.00 dollars
      currency: "USD",
      category: ["Shopping", "Electronics"],
      merchantName: "Electronics Store",
      paymentChannel: "online",
      pending: true,
      plaidTransactionId: "plaid-txn-1",
      createdAt: "2024-01-15T10:00:00Z",
    }

    const result = transformToPlaidFormat(txn)

    expect(result.transaction_id).toBe("plaid-txn-1")
    expect(result.amount).toBe(50.0)
    expect(result.iso_currency_code).toBe("USD")
    expect(result.date).toBe("2024-01-15")
    expect(result.merchant_name).toBe("Electronics Store")
    expect(result.name).toBe("Electronics Store")
    expect(result.pending).toBe(true)
    expect(result.account_id).toBe("acc-1")
    expect(result.category).toEqual(["Shopping", "Electronics"])
    expect(result.payment_channel).toBe("online")
  })

  it("should handle missing optional fields", () => {
    const txn: Transaction = {
      transactionId: "txn-1",
      accountId: "acc-1",
      date: "2024-01-15",
      amount: 1000,
      currency: "USD",
      category: [], // Empty category
      merchantName: "Test",
      paymentChannel: "other",
      pending: false,
      plaidTransactionId: "plaid-1",
      createdAt: "2024-01-15T10:00:00Z",
    }

    const result = transformToPlaidFormat(txn)

    // Empty category should be undefined
    expect(result.category).toBeUndefined()
  })

  it("should use transactionId when plaidTransactionId is missing", () => {
    const txn: Transaction = {
      transactionId: "local-txn-1",
      accountId: "acc-1",
      date: "2024-01-15",
      amount: 1000,
      currency: "USD",
      category: [],
      merchantName: "Test",
      paymentChannel: "other",
      pending: false,
      plaidTransactionId: "", // Empty
      createdAt: "2024-01-15T10:00:00Z",
    }

    const result = transformToPlaidFormat(txn)

    expect(result.transaction_id).toBe("local-txn-1")
  })

  it("uses externalAccountId for account_id when present (ADR-0113 #17)", () => {
    const txn: Transaction = {
      transactionId: "txn-1",
      accountId: "acc-internal",
      date: "2024-01-15",
      amount: 1000,
      currency: "USD",
      category: [],
      merchantName: "Test",
      paymentChannel: "other",
      pending: false,
      plaidTransactionId: "plaid-1",
      createdAt: "2024-01-15T10:00:00Z",
      externalAccountId: "real-bank-acct",
    }

    const result = transformToPlaidFormat(txn)

    expect(result.account_id).toBe("real-bank-acct")
  })

  it("falls back to internal accountId when externalAccountId is absent (backward compat)", () => {
    const txn: Transaction = {
      transactionId: "txn-1",
      accountId: "acc-internal",
      date: "2024-01-15",
      amount: 1000,
      currency: "USD",
      category: [],
      merchantName: "Test",
      paymentChannel: "other",
      pending: false,
      plaidTransactionId: "plaid-1",
      createdAt: "2024-01-15T10:00:00Z",
    }

    const result = transformToPlaidFormat(txn)

    expect(result.account_id).toBe("acc-internal")
  })
})

describe("transformTransactionsToPlaidFormat", () => {
  it("should transform multiple transactions", () => {
    const transactions: Transaction[] = [
      {
        transactionId: "txn-1",
        accountId: "acc-1",
        date: "2024-01-15",
        amount: 1000, // 10.00
        currency: "USD",
        category: [],
        merchantName: "Store 1",
        paymentChannel: "in_store",
        pending: false,
        plaidTransactionId: "plaid-1",
        createdAt: "2024-01-15T10:00:00Z",
      },
      {
        transactionId: "txn-2",
        accountId: "acc-1",
        date: "2024-01-16",
        amount: 2500, // 25.00
        currency: "USD",
        category: [],
        merchantName: "Store 2",
        paymentChannel: "online",
        pending: false,
        plaidTransactionId: "plaid-2",
        createdAt: "2024-01-16T10:00:00Z",
      },
    ]

    const result = transformTransactionsToPlaidFormat(transactions)

    expect(result).toHaveLength(2)
    expect(result[0].amount).toBe(10.0)
    expect(result[1].amount).toBe(25.0)
  })

  it("should return empty array for empty input", () => {
    const result = transformTransactionsToPlaidFormat([])
    expect(result).toHaveLength(0)
  })
})
