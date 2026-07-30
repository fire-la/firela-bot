/**
 * Map a raw Plaid transaction (from RelayPlaidClient.syncTransactions) to the VLT
 * upload shape.
 *
 * Do NOT use core's `convertTransaction` — it produces the internal storage
 * `Transaction` (amount in CENTS). The raw relay response is already in dollars,
 * so this is a near-identity mapping.
 *
 * @packageDocumentation
 */

import type { PlaidTransactionUpload } from "@firela/billclaw-core"

/** Raw Plaid transaction fields we read (subset of the relay schema). */
export interface RawPlaidTransaction {
  transaction_id: string
  account_id?: string
  amount: number // dollars
  date: string
  name: string
  merchant_name?: string
  iso_currency_code?: string
  category?: string[]
  pending?: boolean
  payment_channel?: string
}

/**
 * Convert a raw Plaid transaction to the VLT upload shape.
 *
 * @param raw - raw transaction from `syncTransactions().added` / `.modified`
 * @param fallbackAccountId - account id used when `raw.account_id` is absent
 */
export function toPlaidUpload(
  raw: RawPlaidTransaction,
  fallbackAccountId?: string,
): PlaidTransactionUpload {
  return {
    transaction_id: raw.transaction_id,
    amount: raw.amount,
    iso_currency_code: raw.iso_currency_code ?? "USD",
    date: raw.date,
    merchant_name: raw.merchant_name,
    name: raw.name,
    pending: raw.pending ?? false,
    account_id: raw.account_id ?? fallbackAccountId ?? "",
    category: raw.category,
    payment_channel: raw.payment_channel,
  }
}
