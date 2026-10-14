/**
 * Transform utility for converting parsed transactions to upload formats.
 *
 * Converts RawTransaction from @firela/parser-* to PlaidTransactionUpload
 * (non-CN parsers, plaid/sync transport) or ParsedBillTransactionUpload
 * (CN parsers, parsed-bill/sync transport — fire-la/firela-bot#45) format
 * for VLT backend upload.
 *
 * @module @firela/billclaw-core/parsers
 */

import type { PlaidTransactionUpload, ParsedBillTransactionUpload } from '../upload/vlt-client.js';
import type { RawTransaction } from '@firela/parser-core';
import { randomUUID } from 'crypto';

/**
 * Transform options.
 */
export interface TransformOptions {
  /** Target account ID for transactions */
  accountId: string;
  /** Whether transactions are pending (default: false) */
  pending?: boolean;
}

/**
 * Transform parsed transactions to Plaid format for VLT upload.
 *
 * @param transactions - Array of raw transactions from parser
 * @param options - Transform options (accountId, pending status)
 * @returns Array of PlaidTransactionUpload objects
 */
export function transformParsedTransactions(
  transactions: RawTransaction<unknown>[],
  options: TransformOptions,
): PlaidTransactionUpload[] {
  return transactions.map((txn): PlaidTransactionUpload => ({
    transaction_id: txn.metadata?.id?.toString() || randomUUID(),
    amount: txn.amount.toNumber(),
    iso_currency_code: txn.currency,
    date: toBillDateString(txn.date),
    merchant_name: txn.payee,
    name: txn.description || txn.payee || '',
    pending: options.pending ?? false,
    account_id: options.accountId,
    category: undefined,
    payment_channel: undefined,
  }));
}

/**
 * Extract the per-row payment-method token from parser metadata, verbatim.
 *
 * The pinned TS @firela/parser-cn@0.1.2 emits the key `method`; the wasm
 * crates (bot#44 migration) emit `paymentMethod` per the sdk rename in
 * vlt#1922. Both are bridged here — the token is forwarded raw with NO
 * client-side normalization (ADR-0130 v2 decision 7: normalization is
 * single-sided in vlt).
 */
function fundingSourceFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  // Strict-validity-first over the two keys: a non-string `paymentMethod`
  // (e.g. a malformed future-crate value) must not shadow a valid `method`.
  const candidates = [metadata?.paymentMethod, metadata?.method];
  return candidates.find((c): c is string => typeof c === 'string' && c !== '');
}

/**
 * Build the dedup `id` for a parsed-bill row.
 *
 * Preferred source: the parser's native transaction serial
 * (`customFields.orderNo` — alipay web/mobile both emit it). Bank parsers
 * (cmbc-credit / ccb-debit) have no serial, so rows fall back to a
 * deterministic `date|amount|currency|description #occurrence` composite:
 * vlt hashes the bare tuple when `id` is absent, and two legitimately
 * distinct same-day transactions with an identical tuple (e.g. two subway
 * fares) would collide on vlt's (userId, importId) unique constraint. The
 * occurrence index keeps identical rows distinct while staying stable across
 * re-imports of the same file.
 */
function parsedBillId(
  txn: RawTransaction<unknown>,
  tupleKey: string,
  occurrence: number,
): string {
  const orderNo = (txn.customFields as Record<string, unknown> | undefined)?.orderNo;
  if (typeof orderNo === 'string' && orderNo !== '') return orderNo;
  return `${tupleKey}#${occurrence}`;
}

/**
 * Render a parser Date as the bill's stated calendar date (YYYY-MM-DD).
 * Shared by both upload transports (plaid leg #46, parsed-bill leg #45).
 *
 * All pinned parsers construct dates with the bill's Y/M/D as LOCAL
 * components (`new Date(year, month, day)`), so the date must be read back
 * through local components too — `toISOString()` renders UTC and shifts the
 * date one day early on runtimes east of UTC (e.g. UTC+8, where CN bills
 * originate). Local round-trip is stable in any runtime timezone.
 */
export function toBillDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Transform parsed transactions to parsed-bill format for VLT upload
 * (CN parsers — fire-la/firela-bot#45, ADR-0130 v2 decision 7).
 *
 * Amount passes through with the parser's IGN sign convention (positive =
 * income): vlt's parsed-bill adapter does NOT negate, unlike the plaid
 * adapter used by the legacy CN transport.
 */
export function transformParsedBillTransactions(
  transactions: RawTransaction<unknown>[],
): ParsedBillTransactionUpload[] {
  // Occurrence counter per identical tuple, for the no-serial id fallback.
  const tupleCounts = new Map<string, number>();

  return transactions.map((txn): ParsedBillTransactionUpload => {
    const date = toBillDateString(txn.date);
    const amount = txn.amount.toNumber();
    const description = txn.description || txn.payee || '';
    const tupleKey = `${date}|${amount}|${txn.currency}|${description}`;
    const occurrence = (tupleCounts.get(tupleKey) ?? 0) + 1;
    tupleCounts.set(tupleKey, occurrence);

    const fundingSource = fundingSourceFromMetadata(txn.metadata);

    return {
      id: parsedBillId(txn, tupleKey, occurrence),
      date,
      amount,
      currency: txn.currency,
      description,
      ...(txn.payee ? { payee: txn.payee } : {}),
      ...(fundingSource ? { fundingSource } : {}),
    };
  });
}
