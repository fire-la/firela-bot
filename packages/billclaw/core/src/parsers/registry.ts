/**
 * Parser Registry for CSV file format detection and parsing.
 *
 * Provides auto-detection and manual selection of parsers for various
 * financial file formats (Alipay, HSBC, Degiro, IBKR, etc.)
 *
 * @module @firela/billclaw-core/parsers
 */

import type { Parser, RawTransaction } from '@firela/parser-core';
// Import using namespace imports for CommonJS compatibility
import parserCn from '@firela/parser-cn';
import parserHk from '@firela/parser-hk';
import parserEu from '@firela/parser-eu';

// Extract parsers from namespace imports
const {
  AlipayWebParser,
  AlipayMobileParser,
  CmbcCreditParser,
  CcbDebitParser,
} = parserCn as typeof import('@firela/parser-cn');

const { HsbcHkParser } = parserHk as typeof import('@firela/parser-hk');

const { DegiroParser, InteractiveBrokersParser } = parserEu as typeof import('@firela/parser-eu');

/**
 * Supported parser names.
 */
export type ParserName =
  | 'alipay-web'
  | 'alipay-mobile'
  | 'cmbc-credit'
  | 'ccb-debit'
  | 'hsbc-hk'
  | 'degiro'
  | 'interactive-brokers';

/**
 * Parser class mapping.
 */
const PARSERS: Record<ParserName, new () => Parser<RawTransaction<Record<string, unknown>>>> = {
  'alipay-web': AlipayWebParser,
  'alipay-mobile': AlipayMobileParser,
  'cmbc-credit': CmbcCreditParser,
  'ccb-debit': CcbDebitParser,
  'hsbc-hk': HsbcHkParser,
  degiro: DegiroParser,
  'interactive-brokers': InteractiveBrokersParser,
};

/**
 * CN parser name -> dir Platform canonical, sent as ProviderSyncConfig.platform
 * for method-namespace funding routing (fire-la/firela-bot#45, ADR-0130 D7).
 *
 * GUARDED BRIDGE COPY (Rule 0 disclosure): the single source of truth for
 * platform canonicals is vlt's `prisma/seeds/platforms.seed.ts`
 * (PLATFORMS_DATA); the only sanctioned duplication in the ecosystem is the
 * workflow-synced firela-sdk `scripts/platform-canonicals.json`. This
 * hand table exists solely because the pinned TS @firela/parser-* packages
 * carry no platform metadata (the wasm crates of bot#44 do — replace this
 * table with crate-manifest canonicals when that migration lands). Values
 * are pinned by registry.test.ts; drift against the seed turns it red.
 *
 * Naming trap: `cmb` = China Merchants Bank while the `cmbc-credit` parser is
 * China *Minsheng* Bank -> canonical `cmbc` (near-identical acronyms).
 * Non-CN parsers are absent: they emit no fundingSource rows, so platform
 * is inert for them.
 */
export const PARSER_PLATFORM_CANONICAL: Partial<Record<ParserName, string>> = {
  'alipay-web': 'alipay',
  'alipay-mobile': 'alipay',
  'cmbc-credit': 'cmbc',
  'ccb-debit': 'ccb',
};

/**
 * Parser registry for detecting and obtaining parsers.
 */
export class ParserRegistry {
  /**
   * Auto-detect parser from file content.
   *
   * @param content - File content as Buffer
   * @returns Parser name if detected, null otherwise
   */
  detect(content: Buffer): ParserName | null {
    const contentStr = content.toString('utf-8');
    for (const [name, ParserClass] of Object.entries(PARSERS)) {
      const parser = new ParserClass();
      if (parser.identify(contentStr, content)) {
        return name as ParserName;
      }
    }
    return null;
  }

  /**
   * Get parser instance by name.
   *
   * @param name - Parser name
   * @returns Parser instance
   * @throws Error if parser name is unknown
   */
  get(name: ParserName): Parser<RawTransaction<Record<string, unknown>>> {
    const ParserClass = PARSERS[name];
    if (!ParserClass) {
      throw new Error(`Unknown parser: ${name}`);
    }
    return new ParserClass();
  }

  /**
   * List all available parser names.
   *
   * @returns Array of parser names
   */
  list(): ParserName[] {
    return Object.keys(PARSERS) as ParserName[];
  }
}

/**
 * Default parser registry instance.
 */
export const parserRegistry = new ParserRegistry();
