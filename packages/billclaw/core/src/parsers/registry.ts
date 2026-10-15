/**
 * Parser Registry for bill/statement format detection and parsing, backed by
 * the @firela/* wasm crates (fire-la/firela-bot#44 — the parser single-track
 * ruling's last consumer migration; the deprecated TS @firela/parser-* fleet
 * is gone from the dependency graph).
 *
 * Every crate ships the same module surface (parse/detect over
 * Uint8Array — see src/types/firela-wasm.d.ts); crates are matched to
 * institutions by name: {region}-{institution}[-{variant}].
 *
 * ## Backend-unsupported formats (honest failure by design)
 *
 * These formats are adjudicated backend-unsupported at the 2026-11-30
 * single-track cliff (user ruling 2026-10-09, vlt#1683 comment): the four
 * debit-card PDF parsers (cmb-debit = China Merchants Bank, boc-debit =
 * Bank of China, icbc-debit = ICBC, cmbc-debit = China Minsheng Bank —
 * pdfjs coordinate extraction is not feasible under the wasm
 * size/zero-import budget), legacy `.xls` (OLE2/BIFF) exports (the
 * wechat-xlsx crate detects on the PK zip magic and can never match OLE2),
 * and GBK-encoded HTML (the HTML crates are UTF-8-only). Files in these
 * formats intentionally land in the detect-null "Could not detect file
 * format" path — they fail honestly instead of mis-parsing.
 *
 * @module @firela/billclaw-core/parsers
 */

import * as cnAlipay from '@firela/cn-alipay';
import * as cnAlipayMobile from '@firela/cn-alipay-mobile';
import * as cnAlipayYuebao from '@firela/cn-alipay-yuebao';
import * as cnWechat from '@firela/cn-wechat';
import * as cnWechatXlsx from '@firela/cn-wechat-xlsx';
import * as cnCmbcCredit from '@firela/cn-cmbc-credit';
import * as cnBocCredit from '@firela/cn-boc-credit';
import * as cnIcbcCredit from '@firela/cn-icbc-credit';
import * as cnCcbDebit from '@firela/cn-ccb-debit';
// EU declaration order is load-bearing: eu-deutsche-bank MUST precede
// eu-interactive-brokers — DB's English CSVs end their header with the bare
// keyword "Currency" which also satisfies IB's contains-predicate, the one
// reachable 100/100 detect tie in the fixture corpus; registry order wins
// ties (first declared takes it).
import * as euDeutscheBank from '@firela/eu-deutsche-bank';
import * as euInteractiveBrokers from '@firela/eu-interactive-brokers';
import * as euDegiro from '@firela/eu-degiro';
import * as hkHsbcCredit from '@firela/hk-hsbc-credit';
import * as hkHsbcDebit from '@firela/hk-hsbc-debit';
import type { ParseResult } from '@firela/cn-alipay';

/**
 * Which upload transport a parser's rows ride (bot#45 ruling): CN bills go
 * through parsed-bill/sync (per-row fundingSource + platform canonical);
 * EU/HK bills keep the legacy plaid/sync shape.
 */
export type ParserTransport = 'parsed-bill' | 'plaid';

/**
 * Supported parser names — the @firela/* crate names (region-institution).
 */
export type ParserName =
  | 'cn-alipay'
  | 'cn-alipay-mobile'
  | 'cn-alipay-yuebao'
  | 'cn-wechat'
  | 'cn-wechat-xlsx'
  | 'cn-cmbc-credit'
  | 'cn-boc-credit'
  | 'cn-icbc-credit'
  | 'cn-ccb-debit'
  | 'eu-degiro'
  | 'eu-deutsche-bank'
  | 'eu-interactive-brokers'
  | 'hk-hsbc-credit'
  | 'hk-hsbc-debit';

/** Module surface shared by every crate (see types/firela-wasm.d.ts). */
interface CrateModule {
  parse(bytes: Uint8Array): Promise<ParseResult>;
  detect(bytes: Uint8Array): Promise<number>;
}

interface ParserEntry {
  crate: CrateModule;
  transport: ParserTransport;
}

/**
 * Parser table. Declaration order is the detect() tie-break (see the EU
 * block comment); CN first, credit before debit within an institution.
 */
const PARSERS: Record<ParserName, ParserEntry> = {
  'cn-alipay': { crate: cnAlipay, transport: 'parsed-bill' },
  'cn-alipay-mobile': { crate: cnAlipayMobile, transport: 'parsed-bill' },
  'cn-alipay-yuebao': { crate: cnAlipayYuebao, transport: 'parsed-bill' },
  'cn-wechat': { crate: cnWechat, transport: 'parsed-bill' },
  'cn-wechat-xlsx': { crate: cnWechatXlsx, transport: 'parsed-bill' },
  'cn-cmbc-credit': { crate: cnCmbcCredit, transport: 'parsed-bill' },
  'cn-boc-credit': { crate: cnBocCredit, transport: 'parsed-bill' },
  'cn-icbc-credit': { crate: cnIcbcCredit, transport: 'parsed-bill' },
  'cn-ccb-debit': { crate: cnCcbDebit, transport: 'parsed-bill' },
  'eu-degiro': { crate: euDegiro, transport: 'plaid' },
  'eu-deutsche-bank': { crate: euDeutscheBank, transport: 'plaid' },
  'eu-interactive-brokers': { crate: euInteractiveBrokers, transport: 'plaid' },
  'hk-hsbc-credit': { crate: hkHsbcCredit, transport: 'plaid' },
  'hk-hsbc-debit': { crate: hkHsbcDebit, transport: 'plaid' },
};

/**
 * CN parser name -> dir Platform canonical, sent as ProviderSyncConfig.platform
 * for method-namespace funding routing (bot#45, ADR-0130 D7).
 *
 * GUARDED BRIDGE COPY (Rule 0 disclosure). Single source of truth: vlt's
 * `prisma/seeds/platforms.seed.ts` (PLATFORMS_DATA); the only sanctioned
 * duplication in the ecosystem is the workflow-synced firela-sdk
 * `scripts/platform-canonicals.json`, and per-crate values live in the Rust
 * `Cargo.toml [package.metadata.firela]` (this table was keyed from those at
 * crate 0.1.11). SUPERSSESSION NOTE: bot#45's guard comment said to delete
 * this table when the crate migration lands, expecting crate manifests on
 * npm — the npm artifacts carry NO platform metadata (and no reachable
 * types), so the hand table PERSISTS rekeyed until firela-sdk ships
 * platform metadata on the npm face (tracked on the bot#44 cross-repo sdk
 * issue); the pin test keeps it honest until then.
 *
 * Non-CN parsers are deliberately absent: platform is inert for the plaid
 * transport and must never be the transport discriminator (4 of 5 non-CN
 * crates do carry a platform canonical — eu-degiro deliberately does not,
 * ADR-0015 trap table — which is exactly why presence cannot mean "CN").
 */
export const PARSER_PLATFORM_CANONICAL: Partial<Record<ParserName, string>> = {
  'cn-alipay': 'alipay',
  'cn-alipay-mobile': 'alipay',
  'cn-alipay-yuebao': 'alipay',
  'cn-wechat': 'wechat-pay',
  'cn-wechat-xlsx': 'wechat-pay',
  'cn-cmbc-credit': 'cmbc',
  'cn-boc-credit': 'boc',
  'cn-icbc-credit': 'icbc',
  'cn-ccb-debit': 'ccb',
};

/**
 * Pre-wasm-migration parser names (bot CLI era) -> crate names, for
 * `--parser` muscle memory. `hsbc-hk` is deliberately absent: the single TS
 * parser split into hk-hsbc-credit / hk-hsbc-debit and only the file can
 * disambiguate (auto-detect does).
 */
export const PARSER_ALIASES: Record<string, ParserName> = {
  'alipay-web': 'cn-alipay',
  'alipay-mobile': 'cn-alipay-mobile',
  'cmbc-credit': 'cn-cmbc-credit',
  'ccb-debit': 'cn-ccb-debit',
  degiro: 'eu-degiro',
  'interactive-brokers': 'eu-interactive-brokers',
};

/**
 * Resolve a user-supplied parser name: accepts crate names and legacy
 * aliases, throws a friendly error (naming the choices) otherwise.
 */
export function resolveParserName(name: string): ParserName {
  if (name === 'hsbc-hk') {
    throw new Error(
      "The 'hsbc-hk' parser split into 'hk-hsbc-credit' and 'hk-hsbc-debit' — pick one or rely on auto-detect",
    );
  }
  const resolved = PARSER_ALIASES[name] ?? (name as ParserName);
  // Own-property check: `in` walks the prototype chain, so 'toString' and
  // friends would pass and later resolve to a truthy inherited function
  // whose .crate is undefined.
  if (!Object.hasOwn(PARSERS, resolved)) {
    throw new Error(
      `Unknown parser: ${name} (available: ${Object.keys(PARSERS).join(', ')})`,
    );
  }
  return resolved;
}

/**
 * Parser registry for detecting and obtaining wasm parser crates.
 */
export class ParserRegistry {
  /**
   * Auto-detect the parser for a file's bytes.
   *
   * Fans out detect() across all crates and keeps the highest confidence
   * above 0; ties go to declaration order (strict >). A crate whose detect()
   * REJECTS (e.g. wasm instantiate failure — the loaders reject stickily)
   * simply casts no vote: one broken crate must not kill auto-detection for
   * the other thirteen.
   */
  async detect(content: Buffer | Uint8Array): Promise<ParserName | null> {
    const bytes = new Uint8Array(
      content.buffer,
      content.byteOffset,
      content.byteLength,
    );
    const settled = await Promise.allSettled(
      (Object.keys(PARSERS) as ParserName[]).map(async (name) => ({
        name,
        confidence: await PARSERS[name].crate.detect(bytes),
      })),
    );

    let best: { name: ParserName; confidence: number } | null = null;
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      const { name, confidence } = result.value;
      if (confidence > 0 && (best === null || confidence > best.confidence)) {
        best = { name, confidence };
      }
    }
    return best === null ? null : best.name;
  }

  /**
   * Get the parser crate by name.
   *
   * @throws Error if the parser name is unknown
   */
  get(name: ParserName): CrateModule {
    // Own-property guard (prototype-chain members are truthy but have no crate)
    const entry = Object.hasOwn(PARSERS, name) ? PARSERS[name] : undefined;
    if (!entry) {
      throw new Error(`Unknown parser: ${name}`);
    }
    return entry.crate;
  }

  /**
   * The upload transport this parser's rows ride (bot#45 ruling).
   */
  transport(name: ParserName): ParserTransport {
    const entry = Object.hasOwn(PARSERS, name) ? PARSERS[name] : undefined;
    if (!entry) {
      throw new Error(`Unknown parser: ${name}`);
    }
    return entry.transport;
  }

  /**
   * List all available parser names.
   */
  list(): ParserName[] {
    return Object.keys(PARSERS) as ParserName[];
  }
}

/**
 * Default parser registry instance.
 */
export const parserRegistry = new ParserRegistry();
