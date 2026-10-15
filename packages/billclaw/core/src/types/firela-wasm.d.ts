/**
 * Ambient declarations for the @firela/* wasm parser crates
 * (fire-la/firela-bot#44).
 *
 * This file mirrors the crate-shipped index.d.ts (firela-sdk
 * scripts/_index-dts.template.ts) ONE time. The shipped copy is unreachable
 * under moduleResolution NodeNext: the crate exports maps have no `types`
 * condition, so TypeScript never falls back to the package root index.d.ts
 * and a bare import is TS7016. When firela-sdk ships a types condition in
 * the exports map, this mirror can be deleted (tracked on the bot#44
 * cross-repo sdk issue).
 *
 * Shape: ONE canonical wildcard surface for the cn family (every crate
 * ships the byte-identical module surface — only the wasm payload differs);
 * the eu and hk families re-export it. Wildcards cannot be shadowed here:
 * the workspace declares no other cn/eu/hk @firela packages. Relative
 * imports inside ambient module declarations are impossible (TS2439), which
 * is why the re-exports go through the crate specifier, not a local path.
 */

declare module '@firela/cn-*' {
  export interface RawTransaction {
    /** ISO 8601 calendar date, e.g. "2024-01-15". */
    date: string;
    /** Exact decimal string ("128.50", "-35.00") — never a number. */
    amount: string;
    /** ISO 4217 currency code, e.g. "CNY", "USD", "EUR". */
    currency: string;
    /** Transaction description / narration. */
    description: string;
    /** Payee / counterparty (omitted from JSON when absent). */
    payee?: string;
    /** Institution-specific structured metadata (omitted when absent). */
    metadata?: Record<string, unknown>;
  }

  export interface ProcessWarning {
    message: string;
  }

  export type ProcessError =
    | { code: 'FORMAT'; message: string }
    | { code: 'DETECT'; message: string }
    | { code: 'ENCODING'; message: string }
    | { code: 'INTERNAL'; message: string };

  export interface ProcessSuccess {
    success: true;
    data: RawTransaction[];
    warnings?: ProcessWarning[];
  }

  export interface ProcessFailure {
    success: false;
    errors: ProcessError[];
  }

  export type ParseResult = ProcessSuccess | ProcessFailure;

  /**
   * Parse a bill/statement file. Confidence-independent: run detect() first
   * (or address the crate directly via the registry).
   */
  export function parse(bytes: Uint8Array): Promise<ParseResult>;

  /**
   * Format-detection confidence: 0 = no match, 50 = partial, 100 = definite.
   * NOTE: rejects when the crate's wasm module fails to instantiate — callers
   * fanning out across crates must contain the rejection.
   */
  export function detect(bytes: Uint8Array): Promise<number>;
}

declare module '@firela/eu-*' {
  export * from '@firela/cn-alipay';
}

declare module '@firela/hk-*' {
  export * from '@firela/cn-alipay';
}
