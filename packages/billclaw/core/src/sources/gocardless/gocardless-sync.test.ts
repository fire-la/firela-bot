/**
 * Tests for GoCardless transaction conversion and sync
 */

import { describe, it, expect } from "vitest"
import type { GoCardlessTransaction } from "../../relay/gocardless-types.js"
import { convertGoCardlessTransaction } from "./gocardless-sync.js"

describe("convertGoCardlessTransaction", () => {
  const accountId = "acct-1"

  it("converts a booked GoCardlessTransaction to Transaction", () => {
    const gcTxn: GoCardlessTransaction = {
      transactionId: "gc-txn-1",
      bookingDate: "2026-03-15",
      valueDate: "2026-03-15",
      transactionAmount: { amount: "-50.25", currency: "EUR" },
      remittanceInformationUnstructured: "SUPERMARKET",
    }

    const result = convertGoCardlessTransaction(gcTxn, accountId, false)

    expect(result.transactionId).toBe("acct-1_gc-txn-1")
    expect(result.accountId).toBe("acct-1")
    expect(result.date).toBe("2026-03-15")
    expect(result.amount).toBe(-5025)
    expect(result.currency).toBe("EUR")
    expect(result.merchantName).toBe("SUPERMARKET")
    expect(result.pending).toBe(false)
    expect(result.paymentChannel).toBe("other")
    expect(result.category).toEqual([])
    expect(result.plaidTransactionId).toBe("gc-txn-1")
    expect(result.createdAt).toBeDefined()
  })

  it("handles missing remittanceInformation (defaults to Unknown)", () => {
    const gcTxn: GoCardlessTransaction = {
      transactionId: "gc-txn-2",
      bookingDate: "2026-03-16",
      valueDate: "2026-03-16",
      transactionAmount: { amount: "100.00", currency: "USD" },
    }

    const result = convertGoCardlessTransaction(gcTxn, accountId, false)

    expect(result.merchantName).toBe("Unknown")
  })

  it("handles pending transaction flag", () => {
    const gcTxn: GoCardlessTransaction = {
      transactionId: "gc-txn-3",
      bookingDate: "2026-03-17",
      valueDate: "2026-03-17",
      transactionAmount: { amount: "25.50", currency: "EUR" },
      remittanceInformationUnstructured: "COFFEE SHOP",
    }

    const result = convertGoCardlessTransaction(gcTxn, accountId, true)

    expect(result.pending).toBe(true)
  })

  it("handles zero amount", () => {
    const gcTxn: GoCardlessTransaction = {
      transactionId: "gc-txn-4",
      bookingDate: "2026-03-18",
      valueDate: "2026-03-18",
      transactionAmount: { amount: "0.00", currency: "EUR" },
      remittanceInformationUnstructured: "ZERO TXN",
    }

    const result = convertGoCardlessTransaction(gcTxn, accountId, false)

    expect(result.amount).toBe(0)
  })

  it("passes externalAccountId through when provided (ADR-0113 #17)", () => {
    const gcTxn: GoCardlessTransaction = {
      transactionId: "gc-txn-5",
      bookingDate: "2026-03-19",
      valueDate: "2026-03-19",
      transactionAmount: { amount: "-10.00", currency: "EUR" },
      remittanceInformationUnstructured: "ATM",
    }

    const result = convertGoCardlessTransaction(gcTxn, accountId, false, "gc-bank-uuid")

    expect(result.externalAccountId).toBe("gc-bank-uuid")
  })

  it("leaves externalAccountId undefined when not provided (backward compat)", () => {
    const gcTxn: GoCardlessTransaction = {
      transactionId: "gc-txn-6",
      bookingDate: "2026-03-20",
      valueDate: "2026-03-20",
      transactionAmount: { amount: "-5.00", currency: "EUR" },
      remittanceInformationUnstructured: "COFFEE",
    }

    const result = convertGoCardlessTransaction(gcTxn, accountId, false)

    expect(result.externalAccountId).toBeUndefined()
  })
})
