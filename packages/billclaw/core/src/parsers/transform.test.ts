/**
 * Tests for Transform Utility
 *
 * Note: We test transformParsedTransactions by creating mock RawTransaction
 * objects. Since Decimal is only a type export from @firela/parser-core,
 * we create mock objects that implement the Decimal interface (toNumber method).
 */

import { describe, it, expect } from "vitest"
import {
  transformParsedTransactions,
  transformParsedBillTransactions,
  type TransformOptions,
} from "./transform.js"
import type { RawTransaction } from "@firela/parser-core"

// Minimal Decimal-like type for testing
// This mimics the parts of the Decimal interface that transformParsedTransactions uses
interface MockDecimal {
  toNumber(): number
}

// Create a mock Decimal from a number or string
function mockDecimal(value: number | string): MockDecimal {
  const num = typeof value === "string" ? parseFloat(value) : value
  return {
    toNumber: () => num,
  }
}

describe("transformParsedTransactions", () => {
  // Helper to create mock raw transaction
  function createMockTransaction(overrides: Partial<RawTransaction<unknown>> = {}): RawTransaction<unknown> {
    return {
      date: new Date("2024-03-15"),
      amount: mockDecimal("-88.50") as unknown as RawTransaction["amount"],
      currency: "CNY",
      payee: "Test Merchant",
      description: "Test transaction description",
      category: undefined,
      metadata: { id: "test-txn-123" },
      ...overrides,
    }
  }

  const defaultOptions: TransformOptions = {
    accountId: "test-account-id",
    pending: false,
  }

  describe("basic transformation", () => {
    it("should transform single transaction", () => {
      const transactions = [createMockTransaction()]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result).toHaveLength(1)
      expect(result[0].account_id).toBe("test-account-id")
    })

    it("should transform multiple transactions", () => {
      const transactions = [
        createMockTransaction({ metadata: { id: "txn-1" } }),
        createMockTransaction({ metadata: { id: "txn-2" } }),
        createMockTransaction({ metadata: { id: "txn-3" } }),
      ]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result).toHaveLength(3)
    })
  })

  describe("field mapping", () => {
    it("should map amount correctly", () => {
      const transactions = [createMockTransaction({ amount: mockDecimal("-100.00") as unknown as RawTransaction["amount"] })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].amount).toBe(-100)
    })

    it("should map currency to iso_currency_code", () => {
      const transactions = [createMockTransaction({ currency: "USD" })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].iso_currency_code).toBe("USD")
    })

    it("should map date correctly", () => {
      const testDate = new Date("2024-01-15T10:30:00.000Z")
      const transactions = [createMockTransaction({ date: testDate })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].date).toBe("2024-01-15")
    })

    it("should map payee to merchant_name", () => {
      const transactions = [createMockTransaction({ payee: "Amazon" })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].merchant_name).toBe("Amazon")
    })

    it("should map description to name", () => {
      const transactions = [createMockTransaction({ description: "Test description" })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].name).toBe("Test description")
    })

    it("should fallback to payee for name when description is empty", () => {
      const transactions = [createMockTransaction({ description: "", payee: "Payee Name" })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].name).toBe("Payee Name")
    })

    it("should generate transaction_id from metadata.id", () => {
      const transactions = [createMockTransaction({ metadata: { id: "my-custom-id" } })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].transaction_id).toBe("my-custom-id")
    })
  })

  describe("account_id handling", () => {
    it("should use accountId from options", () => {
      const transactions = [createMockTransaction()]
      const options: TransformOptions = { accountId: "custom-account" }
      const result = transformParsedTransactions(transactions, options)

      expect(result[0].account_id).toBe("custom-account")
    })
  })

  describe("pending flag", () => {
    it("should set pending to false by default", () => {
      const transactions = [createMockTransaction()]
      const result = transformParsedTransactions(transactions, { accountId: "test" })

      expect(result[0].pending).toBe(false)
    })

    it("should respect pending option", () => {
      const transactions = [createMockTransaction()]
      const result = transformParsedTransactions(transactions, { accountId: "test", pending: true })

      expect(result[0].pending).toBe(true)
    })
  })

  describe("optional fields", () => {
    it("should set category to undefined", () => {
      const transactions = [createMockTransaction()]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].category).toBeUndefined()
    })

    it("should set payment_channel to undefined", () => {
      const transactions = [createMockTransaction()]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].payment_channel).toBeUndefined()
    })
  })

  describe("edge cases", () => {
    it("should handle empty transactions array", () => {
      const result = transformParsedTransactions([], defaultOptions)
      expect(result).toHaveLength(0)
    })

    it("should handle zero amount", () => {
      const transactions = [createMockTransaction({ amount: mockDecimal("0") as unknown as RawTransaction["amount"] })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].amount).toBe(0)
    })

    it("should handle very small amounts", () => {
      const transactions = [createMockTransaction({ amount: mockDecimal("0.01") as unknown as RawTransaction["amount"] })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].amount).toBe(0.01)
    })

    it("should handle very large amounts", () => {
      const transactions = [createMockTransaction({ amount: mockDecimal("9999999.99") as unknown as RawTransaction["amount"] })]
      const result = transformParsedTransactions(transactions, defaultOptions)

      expect(result[0].amount).toBe(9999999.99)
    })
  })
})

describe("transformParsedBillTransactions", () => {
  // Same mock helpers as above, scoped for the parsed-bill leg (#45).
  // Dates use LOCAL-component construction (new Date(y, m, d)) to match how
  // the pinned parsers build them — the transform reads local components
  // back, so these tests are timezone-stable on any runtime.
  function createMockTransaction(overrides: Partial<RawTransaction<unknown>> = {}): RawTransaction<unknown> {
    return {
      date: new Date(2024, 2, 15),
      amount: mockDecimal("-88.50") as unknown as RawTransaction["amount"],
      currency: "CNY",
      payee: "Test Merchant",
      description: "Test transaction description",
      category: undefined,
      metadata: { method: "wallet-balance" },
      ...overrides,
    }
  }

  it("renders the bill's stated calendar date regardless of runtime timezone", () => {
    // A parser Date at local midnight must round-trip to the same date —
    // toISOString() would shift it a day early on runtimes east of UTC.
    const [row] = transformParsedBillTransactions([createMockTransaction()])
    expect(row.date).toBe("2024-03-15")
  })

  it("maps to the camelCase parsed-bill row shape", () => {
    const result = transformParsedBillTransactions([createMockTransaction()])

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: "2024-03-15|-88.5|CNY|Test transaction description#1",
      date: "2024-03-15",
      amount: -88.5,
      currency: "CNY",
      description: "Test transaction description",
      payee: "Test Merchant",
      fundingSource: "wallet-balance",
    })
  })

  it("passes the parser's IGN-signed amount through verbatim (no negation)", () => {
    const expense = transformParsedBillTransactions([
      createMockTransaction({ amount: mockDecimal("-42.00") as unknown as RawTransaction["amount"] }),
    ])
    const income = transformParsedBillTransactions([
      createMockTransaction({ amount: mockDecimal("42.00") as unknown as RawTransaction["amount"] }),
    ])

    expect(expense[0].amount).toBe(-42)
    expect(income[0].amount).toBe(42)
  })

  describe("fundingSource extraction (dual-key bridge)", () => {
    it("reads metadata.method (pinned TS @firela/parser-cn)", () => {
      const result = transformParsedBillTransactions([
        createMockTransaction({ metadata: { method: "bank-card(1234)" } }),
      ])
      expect(result[0].fundingSource).toBe("bank-card(1234)")
    })

    it("reads metadata.paymentMethod (wasm crates after bot#44)", () => {
      const result = transformParsedBillTransactions([
        createMockTransaction({ metadata: { paymentMethod: "huabei-credit" } }),
      ])
      expect(result[0].fundingSource).toBe("huabei-credit")
    })

    it("forwards the token verbatim — no normalization", () => {
      const raw = "  CMB-debit-card(１２３４) "
      const result = transformParsedBillTransactions([
        createMockTransaction({ metadata: { method: raw } }),
      ])
      expect(result[0].fundingSource).toBe(raw)
    })

    it("omits fundingSource for non-string, empty, or absent tokens", () => {
      const result = transformParsedBillTransactions([
        createMockTransaction({ metadata: { method: 123 } }),
        createMockTransaction({ metadata: { method: "" } }),
        createMockTransaction({ metadata: undefined }),
        createMockTransaction({ metadata: { payeeAccount: "x@y" } }),
      ])

      for (const row of result) {
        expect(row.fundingSource).toBeUndefined()
        expect("fundingSource" in row).toBe(false)
      }
    })

    it("does not let a non-string paymentMethod shadow a valid method", () => {
      const result = transformParsedBillTransactions([
        createMockTransaction({ metadata: { paymentMethod: 123, method: "bank-card(1234)" } }),
      ])
      expect(result[0].fundingSource).toBe("bank-card(1234)")
    })
  })

  describe("id strategy", () => {
    it("uses customFields.orderNo (parser-native serial) when present", () => {
      const result = transformParsedBillTransactions([
        createMockTransaction({
          customFields: { orderNo: "2024031511003001", status: "success" },
        }),
      ])
      expect(result[0].id).toBe("2024031511003001")
    })

    it("gives distinct ids to identical same-day rows via the occurrence index", () => {
      const twin = () => createMockTransaction({ customFields: undefined })
      const result = transformParsedBillTransactions([twin(), twin()])

      expect(result[0].id).not.toBe(result[1].id)
      expect(result[0].id).toBe("2024-03-15|-88.5|CNY|Test transaction description#1")
      expect(result[1].id).toBe("2024-03-15|-88.5|CNY|Test transaction description#2")
    })

    it("produces stable ids across re-transforms of the same rows (re-import dedup)", () => {
      const rows = [
        createMockTransaction({ customFields: undefined }),
        createMockTransaction({ customFields: undefined }),
      ]
      const first = transformParsedBillTransactions(rows).map((r) => r.id)
      const second = transformParsedBillTransactions(rows).map((r) => r.id)

      expect(first).toEqual(second)
    })
  })

  it("falls back description to payee, and omits payee when absent", () => {
    const [noDescription] = transformParsedBillTransactions([
      createMockTransaction({ description: "", payee: "Fallback Payee" }),
    ])
    const [noPayee] = transformParsedBillTransactions([
      createMockTransaction({ payee: undefined }),
    ])

    expect(noDescription.description).toBe("Fallback Payee")
    expect("payee" in noPayee).toBe(false)
  })
})
