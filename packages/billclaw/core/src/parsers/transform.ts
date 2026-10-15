/**
 * Transform utilities converting wasm-crate parse output to upload formats.
 *
 * Input is the crate-native wire shape (RawTransaction from
 * '@firela/cn-alipay' — one shared surface for all crates, see
 * types/firela-wasm.d.ts): dates are "YYYY-MM-DD" strings (the bill's stated
 * calendar date — no Date construction, so the bot#46 timezone hazard is
 * structurally gone) and amounts are exact decimal strings.
 *
 * Two output legs (bot#45 ruling): ParsedBillTransactionUpload for CN
 * parsers (parsed-bill/sync transport) and PlaidTransactionUpload for
 * EU/HK parsers (legacy plaid/sync transport).
 *
 * @module @firela/billclaw-core/parsers
 */

import type { PlaidTransactionUpload, ParsedBillTransactionUpload } from '../upload/vlt-client.js';
import type { RawTransaction as CrateTransaction } from '@firela/cn-alipay';
import { randomUUID } from 'crypto';

export type { CrateTransaction };

/**
 * Transform options for the plaid leg.
 */
export interface TransformOptions {
  /** Target account ID for transactions */
  accountId: string;
  /** Whether transactions are pending (default: false) */
  pending?: boolean;
}

/**
 * Transform crate output to Plaid format for VLT upload (EU/HK parsers).
 */
export function transformParsedTransactions(
  transactions: CrateTransaction[],
  options: TransformOptions,
): PlaidTransactionUpload[] {
  return transactions.map((txn): PlaidTransactionUpload => ({
    // No crate emits metadata.id (the TS-era read was already dead: the TS
    // degiro parser emitted orderId, not id) — stable crate-serial ids for
    // the plaid leg are tracked as a bot#44 follow-up issue.
    transaction_id: txn.metadata?.id?.toString() || randomUUID(),
    amount: Number(txn.amount),
    iso_currency_code: txn.currency,
    date: txn.date,
    merchant_name: txn.payee,
    name: txn.description || txn.payee || '',
    pending: options.pending ?? false,
    account_id: options.accountId,
    category: undefined,
    payment_channel: undefined,
  }));
}

/**
 * Extract the per-row payment-method token from crate metadata, verbatim.
 *
 * Crates emit the key `paymentMethod` (the vlt#1922 sdk-leg rename; the TS
 * fleet's `method` key retired with it in bot#44). The token is forwarded
 * raw with NO client-side normalization (ADR-0130 v2 decision 7:
 * normalization is single-sided in vlt).
 */
function fundingSourceFromMetadata(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const token = metadata?.paymentMethod;
  return typeof token === 'string' && token !== '' ? token : undefined;
}

/**
 * Build the dedup `id` for a parsed-bill row.
 *
 * Preferred source: the crate's native transaction serial
 * (`metadata.orderNo` — alipay web/mobile and wechat emit it). cmbc/ccb/boc/
 * icbc rows carry no serial, so they fall back to a deterministic
 * `date|amount|currency|description #occurrence` composite: vlt hashes the
 * bare tuple when `id` is absent, and two legitimately distinct same-day
 * transactions with an identical tuple would collide on vlt's
 * (userId, importId) unique constraint. The occurrence index keeps
 * identical rows distinct while staying stable across re-imports of the
 * same file (tuple keys use the raw decimal string — exact, no float
 * formatting variance).
 */
function parsedBillId(
  txn: CrateTransaction,
  tupleKey: string,
  occurrence: number,
): string {
  const orderNo = txn.metadata?.orderNo;
  if (typeof orderNo === 'string' && orderNo !== '') return orderNo;
  return `${tupleKey}#${occurrence}`;
}

/**
 * Transform crate output to parsed-bill format for VLT upload
 * (CN parsers — bot#45, ADR-0130 v2 decision 7).
 *
 * Amount converts from the crate's exact decimal string to a number (the
 * wire field's type); sign convention is the crate/IGN convention
 * (positive = income), passed through verbatim.
 */
export function transformParsedBillTransactions(
  transactions: CrateTransaction[],
): ParsedBillTransactionUpload[] {
  // Occurrence counter per identical tuple, for the no-serial id fallback.
  const tupleCounts = new Map<string, number>();

  return transactions.map((txn): ParsedBillTransactionUpload => {
    const description = txn.description || txn.payee || '';
    // NOTE(bot#44 migration): tuple keys switched from float-rendered
    // amounts to the crate's raw decimal string — a serial-less file first
    // imported under the TS parsers and re-imported after this change gets
    // new fallback ids (documented in the PR; orderNo rows are unaffected).
    const tupleKey = `${txn.date}|${txn.amount}|${txn.currency}|${description}`;
    const occurrence = (tupleCounts.get(tupleKey) ?? 0) + 1;
    tupleCounts.set(tupleKey, occurrence);

    const fundingSource = fundingSourceFromMetadata(txn.metadata);

    return {
      id: parsedBillId(txn, tupleKey, occurrence),
      date: txn.date,
      amount: Number(txn.amount),
      currency: txn.currency,
      description,
      ...(txn.payee ? { payee: txn.payee } : {}),
      ...(fundingSource ? { fundingSource } : {}),
    };
  });
}
