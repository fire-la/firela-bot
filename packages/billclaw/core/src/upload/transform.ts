/**
 * Transaction transformation for VLT upload
 *
 * Converts BillClaw Transaction format to Plaid format for VLT API.
 * This is the REVERSE of convertTransaction in plaid-sync.ts.
 *
 * @packageDocumentation
 */

import type { Transaction } from "../storage/transaction-storage.js"
import type { PlaidTransactionUpload } from "./vlt-client.js"

/**
 * Transform a BillClaw Transaction to Plaid format for VLT upload
 *
 * Key conversion: amount is in cents in BillClaw, but VLT expects dollars.
 *
 * @param txn - BillClaw transaction
 * @returns Plaid-format transaction for VLT
 */
export function transformToPlaidFormat(txn: Transaction): PlaidTransactionUpload {
  return {
    transaction_id: txn.plaidTransactionId || txn.transactionId,
    // Convert cents to dollars (BillClaw stores in cents, VLT expects dollars)
    amount: txn.amount / 100,
    iso_currency_code: txn.currency,
    date: txn.date,
    merchant_name: txn.merchantName,
    name: txn.merchantName,
    pending: txn.pending,
    // Prefer the provider's real account_id (ADR-0113 #17 multi-account routing);
    // fall back to the internal accountId for legacy data without externalAccountId.
    account_id: txn.externalAccountId ?? txn.accountId,
    category: txn.category.length > 0 ? txn.category : undefined,
    payment_channel: txn.paymentChannel,
  }
}

/**
 * Transform multiple BillClaw transactions to Plaid format
 *
 * @param transactions - BillClaw transactions
 * @returns Plaid-format transactions for VLT
 */
export function transformTransactionsToPlaidFormat(
  transactions: Transaction[],
): PlaidTransactionUpload[] {
  return transactions.map(transformToPlaidFormat)
}
