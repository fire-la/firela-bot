/**
 * Tests for the transform utilities over the crate-native wire shape
 * (fire-la/firela-bot#44): dates are "YYYY-MM-DD" strings and amounts are
 * exact decimal strings, as emitted by the @firela/* wasm crates.
 */

import { describe, it, expect } from "vitest"
import {
  transformParsedTransactions,
  transformParsedBillTransactions,
  type TransformOptions,
} from "./transform.js"
import type { CrateTransaction } from "@firela/cn-alipay"

describe("transformParsedTransactions (plaid leg, EU/HK)", () => {
  const defaultOptions: TransformOptions = {
    accountId: "test-account-id",
    pending: false,
  }

  function createMockTransaction(
    overrides: Partial<CrateTransaction> = {},
  ): CrateTransaction {
    return {
      date: "2024-03-15",
      amount: "-88.50",
      currency: "CNY",
      payee: "Test Merchant",
      description: "Test transaction description",
      metadata: {},
      ...overrides,
    }
  }

  it("maps the crate wire shape to the plaid row shape", () => {
    const [row] = transformParsedTransactions([createMockTransaction()], defaultOptions)

    expect(row).toEqual({
      transaction_id: expect.any(String),
      amount: -88.5,
      iso_currency_code: "CNY",
      date: "2024-03-15",
      merchant_name: "Test Merchant",
      name: "Test transaction description",
      pending: false,
      account_id: "test-account-id",
      category: undefined,
      payment_channel: undefined,
    })
  })

  it("converts the exact decimal string to a number (IGN sign verbatim)", () => {
    const rows = transformParsedTransactions(
      [
        createMockTransaction({ amount: "-42.00" }),
        createMockTransaction({ amount: "42.00" }),
        createMockTransaction({ amount: "0" }),
        createMockTransaction({ amount: "9999999.99" }),
      ],
      defaultOptions,
    )

    expect(rows.map((r) => r.amount)).toEqual([-42, 42, 0, 9999999.99])
  })

  it("falls back to payee for name when description is empty", () => {
    const [row] = transformParsedTransactions(
      [createMockTransaction({ description: "" })],
      defaultOptions,
    )
    expect(row.name).toBe("Test Merchant")
  })

  it("keeps the pending flag from options", () => {
    const [row] = transformParsedTransactions(
      [createMockTransaction()],
      { ...defaultOptions, pending: true },
    )
    expect(row.pending).toBe(true)
  })
})

describe("transformParsedBillTransactions (CN leg, bot#45)", () => {
  function createMockTransaction(
    overrides: Partial<CrateTransaction> = {},
  ): CrateTransaction {
    return {
      date: "2024-03-15",
      amount: "-88.50",
      currency: "CNY",
      payee: "Test Merchant",
      description: "Test transaction description",
      metadata: { paymentMethod: "wallet-balance" },
      ...overrides,
    }
  }

  it("maps to the camelCase parsed-bill row shape", () => {
    const [row] = transformParsedBillTransactions([createMockTransaction()])

    expect(row).toEqual({
      id: "2024-03-15|-88.50|CNY|Test transaction description#1",
      date: "2024-03-15",
      amount: -88.5,
      currency: "CNY",
      description: "Test transaction description",
      payee: "Test Merchant",
      fundingSource: "wallet-balance",
    })
  })

  it("passes the crate's IGN-signed decimal string through as a number (no negation)", () => {
    const [expense] = transformParsedBillTransactions([
      createMockTransaction({ amount: "-42.00" }),
    ])
    const [income] = transformParsedBillTransactions([
      createMockTransaction({ amount: "42.00" }),
    ])

    expect(expense.amount).toBe(-42)
    expect(income.amount).toBe(42)
  })

  describe("fundingSource extraction (crate key only)", () => {
    it("reads metadata.paymentMethod", () => {
      const [row] = transformParsedBillTransactions([
        createMockTransaction({ metadata: { paymentMethod: "bank-card(1234)" } }),
      ])
      expect(row.fundingSource).toBe("bank-card(1234)")
    })

    it("forwards the token verbatim — no normalization", () => {
      const raw = "  CMB-debit-card(１２３４) "
      const [row] = transformParsedBillTransactions([
        createMockTransaction({ metadata: { paymentMethod: raw } }),
      ])
      expect(row.fundingSource).toBe(raw)
    })

    it("omits fundingSource for non-string, empty, or absent tokens", () => {
      const rows = transformParsedBillTransactions([
        createMockTransaction({ metadata: { paymentMethod: 123 } }),
        createMockTransaction({ metadata: { paymentMethod: "" } }),
        createMockTransaction({ metadata: undefined }),
        createMockTransaction({ metadata: { orderNo: "x" } }),
      ])

      for (const row of rows) {
        expect(row.fundingSource).toBeUndefined()
        expect("fundingSource" in row).toBe(false)
      }
    })

    it("no longer reads the retired TS-era 'method' key (bot#44 deleted the bridge)", () => {
      const [row] = transformParsedBillTransactions([
        createMockTransaction({ metadata: { method: "legacy-key" } }),
      ])
      expect(row.fundingSource).toBeUndefined()
    })
  })

  describe("id strategy", () => {
    it("uses metadata.orderNo (crate-native serial) when present", () => {
      const [row] = transformParsedBillTransactions([
        createMockTransaction({ metadata: { orderNo: "2024031511003001" } }),
      ])
      expect(row.id).toBe("2024031511003001")
    })

    it("gives distinct ids to identical same-day rows via the occurrence index", () => {
      const rows = transformParsedBillTransactions([
        createMockTransaction({ metadata: {} }),
        createMockTransaction({ metadata: {} }),
      ])

      expect(rows[0].id).not.toBe(rows[1].id)
      expect(rows[0].id).toBe("2024-03-15|-88.50|CNY|Test transaction description#1")
      expect(rows[1].id).toBe("2024-03-15|-88.50|CNY|Test transaction description#2")
    })

    it("produces stable ids across re-transforms of the same rows (re-import dedup)", () => {
      const txns = [
        createMockTransaction({ metadata: {} }),
        createMockTransaction({ metadata: {} }),
      ]
      const first = transformParsedBillTransactions(txns).map((r) => r.id)
      const second = transformParsedBillTransactions(txns).map((r) => r.id)

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
