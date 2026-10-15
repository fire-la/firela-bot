/**
 * Parser module exports (also the `@firela/billclaw-core/parsers` subpath
 * surface — the root barrel no longer re-exports this module, keeping the
 * wasm crates out of the CF worker bundle graph; fire-la/firela-bot#44).
 *
 * @module @firela/billclaw-core/parsers
 */

export {
  ParserRegistry,
  parserRegistry,
  PARSER_PLATFORM_CANONICAL,
  PARSER_ALIASES,
  resolveParserName,
  type ParserName,
  type ParserTransport,
} from './registry.js';
export {
  transformParsedTransactions,
  transformParsedBillTransactions,
  type TransformOptions,
  type CrateTransaction,
} from './transform.js';
