/**
 * Tests for Plaid transaction conversion
 */

import { describe, it, expect } from "vitest"
import { convertTransaction } from "./plaid-sync.js"

describe("convertTransaction", () => {
  const accountId = "acct-1"

  it("converts a Plaid transaction to Transaction", () => {
    const plaidTxn = {
      transaction_id: "plaid-txn-1",
      account_id: "plaid-acct-real",
      amount: 50.25,
      date: "2026-03-15",
      iso_currency_code: "USD",
      merchant_name: "SUPERMARKET",
      name: "SUPERMARKET",
      category: ["Food"],
      payment_channel: "in store",
      pending: false,
    }

    const result = convertTransaction(plaidTxn, accountId)

    expect(result.transactionId).toBe("acct-1_plaid-txn-1")
    expect(result.accountId).toBe("acct-1")
    expect(result.amount).toBe(5025)
    expect(result.currency).toBe("USD")
    expect(result.merchantName).toBe("SUPERMARKET")
    expect(result.pending).toBe(false)
  })

  it("passes externalAccountId through when provided (ADR-0113 #17)", () => {
    const plaidTxn = {
      transaction_id: "plaid-txn-2",
      account_id: "plaid-acct-real",
      amount: 10,
      date: "2026-03-16",
      iso_currency_code: "USD",
      name: "TEST",
      payment_channel: "other",
      pending: false,
    }

    const result = convertTransaction(plaidTxn, accountId, plaidTxn.account_id)

    expect(result.externalAccountId).toBe("plaid-acct-real")
  })

  it("leaves externalAccountId undefined when not provided (backward compat)", () => {
    const plaidTxn = {
      transaction_id: "plaid-txn-3",
      account_id: "plaid-acct-real",
      amount: 5,
      date: "2026-03-17",
      iso_currency_code: "USD",
      name: "TEST",
      payment_channel: "other",
      pending: false,
    }

    const result = convertTransaction(plaidTxn, accountId)

    expect(result.externalAccountId).toBeUndefined()
  })
})
