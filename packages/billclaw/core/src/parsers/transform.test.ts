/**
 * Tests for the transform utilities over the crate-native wire shape
 * (fire-la/firela-bot#44): dates are "YYYY-MM-DD" strings and amounts are
 * exact decimal strings, as emitted by the @firela/* wasm crates.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
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

  describe("id strategy (bot#51)", () => {
    it("uses the crate serial when present (orderId first, reference fallback)", () => {
      const [orderRow] = transformParsedTransactions(
        [createMockTransaction({ metadata: { orderId: "ORD001", reference: "12345" } })],
        defaultOptions,
      )
      expect(orderRow.transaction_id).toBe("ORD001")

      const [referenceRow] = transformParsedTransactions(
        [createMockTransaction({ metadata: { reference: "12347" } })],
        defaultOptions,
      )
      expect(referenceRow.transaction_id).toBe("12347")
    })

    it("ignores empty-string serials (IB trade rows emit them) and falls back to the composite", () => {
      const [row] = transformParsedTransactions(
        [createMockTransaction({ metadata: { ibOrderId: "", orderId: "" } })],
        defaultOptions,
      )
      expect(row.transaction_id).toBe(
        "2024-03-15|-88.50|CNY|Test transaction description#1",
      )
    })

    it("gives distinct ids to identical same-day rows via the occurrence index", () => {
      const rows = transformParsedTransactions(
        [
          createMockTransaction({ metadata: undefined }),
          createMockTransaction({ metadata: undefined }),
        ],
        defaultOptions,
      )

      expect(rows[0].transaction_id).not.toBe(rows[1].transaction_id)
      expect(rows[0].transaction_id).toBe(
        "2024-03-15|-88.50|CNY|Test transaction description#1",
      )
      expect(rows[1].transaction_id).toBe(
        "2024-03-15|-88.50|CNY|Test transaction description#2",
      )
    })

    it("produces stable ids across re-transforms of the same rows (re-import dedup)", () => {
      const txns = [
        createMockTransaction({ metadata: { orderId: "ORD001" } }),
        createMockTransaction({ metadata: {} }),
        createMockTransaction({ metadata: {} }),
      ]
      const ids = (rows: CrateTransaction[]) =>
        transformParsedTransactions(rows, defaultOptions).map((r) => r.transaction_id)

      expect(ids(txns)).toEqual(ids(txns))
    })
  })
})

describe("transformParsedTransactions over vendored EU/HK goldens (bot#51)", () => {
  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

  const GOLDEN_MATRIX: Array<{ crate: string; golden: string }> = [
    { crate: "eu-degiro", golden: "expected.json" },
    { crate: "eu-interactive-brokers", golden: "expected.json" },
    { crate: "eu-deutsche-bank", golden: "expected-de.json" },
    { crate: "eu-deutsche-bank", golden: "expected-en.json" },
    { crate: "hk-hsbc-credit", golden: "expected.json" },
    { crate: "hk-hsbc-debit", golden: "expected.json" },
  ]

  for (const { crate, golden } of GOLDEN_MATRIX) {
    it(`${crate}/${golden}: re-transforming yields identical transaction_ids (AC2, re-import dedup)`, () => {
      const parsed = JSON.parse(
        readFileSync(join(fixturesDir, crate, golden), "utf-8"),
      ) as { data: CrateTransaction[] }
      const options: TransformOptions = { accountId: "golden-account", pending: false }
      const ids = (rows: CrateTransaction[]) =>
        transformParsedTransactions(rows, options).map((r) => r.transaction_id)

      expect(parsed.data.length).toBeGreaterThan(0)
      const first = ids(parsed.data)
      expect(first).toEqual(ids(parsed.data))
      // Re-import dedup safety property: ids are unique within the file
      // (a shared serial would silently drop rows on the server side).
      expect(new Set(first).size).toBe(first.length)
    })
  }
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
