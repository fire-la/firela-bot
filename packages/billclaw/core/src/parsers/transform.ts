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
 *
 * `transaction_id` is deterministic (bot#51): the crate serial when
 * present, else the composite described on rowIdFactory — re-importing
 * the same file yields identical ids so vlt's (userId, importId) dedup
 * holds. Files imported before bot#51 hold random UUIDs and will not
 * dedup against the new ids (same class of transition as bot#45).
 */
export function transformParsedTransactions(
  transactions: CrateTransaction[],
  options: TransformOptions,
): PlaidTransactionUpload[] {
  const nextRowId = rowIdFactory(PLAID_SERIAL_KEYS);

  return transactions.map((txn): PlaidTransactionUpload => {
    const description = txn.description || txn.payee || '';

    return {
      transaction_id: nextRowId(txn, description),
      amount: Number(txn.amount),
      iso_currency_code: txn.currency,
      date: txn.date,
      merchant_name: txn.payee,
      name: description,
      pending: options.pending ?? false,
      account_id: options.accountId,
      category: undefined,
      payment_channel: undefined,
    };
  });
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
 * Serial metadata keys per leg, first non-empty string wins.
 *
 * CN leg (bot#45): `orderNo` (alipay web/mobile/yuebao, wechat).
 * Plaid leg (bot#51): `orderNo` takes precedence (crate-surface parity
 * with the CN leg's canonical serial — no EU/HK crate emits it today),
 * then `orderId`/`reference` (degiro), then `ibOrderId` (IB — emitted as
 * empty strings on trade rows, hence the non-empty guard).
 * deutsche-bank `customerReference` is deliberately excluded: it repeats
 * across months on standing orders (e.g. "SO-RENT") and would dedup away
 * legitimate transactions.
 */
const CN_SERIAL_KEYS = ['orderNo'] as const;
const PLAID_SERIAL_KEYS = ['orderNo', 'orderId', 'reference', 'ibOrderId'] as const;

/**
 * Per-import dedup-id builder, shared by both upload legs (bot#45 CN,
 * bot#51 plaid).
 *
 * Preferred id: the crate's native transaction serial (the leg's
 * serialKeys above). Rows without a serial (cmbc/ccb/boc/icbc, IB cash
 * rows, deutsche-bank, HSBC) fall back to a deterministic
 * `date|amount|currency|description #occurrence` composite: two
 * legitimately distinct same-day transactions with an identical tuple
 * would collide on vlt's (userId, importId) unique constraint. The
 * occurrence index keeps identical rows distinct while staying stable
 * across re-imports of the same file (tuple keys use the raw decimal
 * string — exact, no float formatting variance). One factory per
 * transform call: the occurrence counter is scoped to one file.
 */
function rowIdFactory(serialKeys: readonly string[]) {
  // Occurrence counter per identical tuple, for the no-serial id fallback.
  const tupleCounts = new Map<string, number>();

  return (txn: CrateTransaction, description: string): string => {
    const tupleKey = `${txn.date}|${txn.amount}|${txn.currency}|${description}`;
    const occurrence = (tupleCounts.get(tupleKey) ?? 0) + 1;
    tupleCounts.set(tupleKey, occurrence);

    for (const key of serialKeys) {
      const serial = txn.metadata?.[key];
      if (typeof serial === 'string' && serial !== '') return serial;
    }
    return `${tupleKey}#${occurrence}`;
  };
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
  const nextRowId = rowIdFactory(CN_SERIAL_KEYS);

  return transactions.map((txn): ParsedBillTransactionUpload => {
    const description = txn.description || txn.payee || '';
    // NOTE(bot#44 migration): tuple keys switched from float-rendered
    // amounts to the crate's raw decimal string — a serial-less file first
    // imported under the TS parsers and re-imported after this change gets
    // new fallback ids (documented in the PR; orderNo rows are unaffected).
    const fundingSource = fundingSourceFromMetadata(txn.metadata);

    return {
      id: nextRowId(txn, description),
      date: txn.date,
      amount: Number(txn.amount),
      currency: txn.currency,
      description,
      ...(txn.payee ? { payee: txn.payee } : {}),
      ...(fundingSource ? { fundingSource } : {}),
    };
  });
}
