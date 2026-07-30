/**
 * GoCardless sync functions for transaction conversion
 *
 * Handles conversion from GoCardless transaction format to internal
 * BillClaw Transaction format, plus sync orchestration.
 */

import type { GoCardlessTransaction } from "../../relay/gocardless-types.js"
import type { Transaction } from "../../storage/transaction-storage.js"

/**
 * Convert a GoCardless transaction to internal Transaction format
 *
 * Key differences from Plaid:
 * - Amounts are strings (need parseFloat then * 100 for cents)
 * - No payment channel concept (defaults to "other")
 * - No category information (empty array)
 * - merchantName from remittanceInformationUnstructured or "Unknown"
 *
 * @param gcTxn - GoCardless transaction to convert
 * @param accountId - Internal account ID
 * @param isPending - Whether this is a pending (vs booked) transaction
 * @returns Transaction in internal format
 */
export function convertGoCardlessTransaction(
  gcTxn: GoCardlessTransaction,
  accountId: string,
  isPending: boolean = false,
  externalAccountId?: string,
): Transaction {
  return {
    transactionId: `${accountId}_${gcTxn.transactionId}`,
    accountId,
    date: gcTxn.bookingDate,
    amount: Math.round(parseFloat(gcTxn.transactionAmount.amount) * 100),
    currency: gcTxn.transactionAmount.currency,
    category: [],
    merchantName: gcTxn.remittanceInformationUnstructured || "Unknown",
    paymentChannel: "other",
    pending: isPending,
    plaidTransactionId: gcTxn.transactionId,
    createdAt: new Date().toISOString(),
    externalAccountId,
  }
}
