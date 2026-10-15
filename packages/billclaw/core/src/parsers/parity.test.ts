/**
 * Parser parity tests (fire-la/firela-bot#44).
 *
 * Layer 1 (this file, TS-parser baseline): runs the CURRENT registry over the
 * vendored fixtures the TS parsers can detect, pinning the pre-migration
 * output in the committed snapshot file (__snapshots__/parity.test.ts.snap).
 * That snapshot file IS the reviewed before/after record — the migration
 * commit re-runs `vitest -u` and the resulting .snap diff is reviewed line by
 * line in the PR. (External snapshots, not inline: the tests are generated in
 * a loop, and inline snapshots cannot distinguish shared call-sites.)
 * After the migration lands, this layer is retired (deleted); Layer 2 (crate
 * output deep-equals the vendored frozen goldens) becomes the single
 * permanent pin.
 *
 * Fixtures without a TS-parser predecessor (yuebao, wechat, boc, icbc,
 * wechat-xlsx, eu-deutsche-bank, GBK variants) have no Layer 1 baseline —
 * they are net-new coverage asserted only by Layer 2 after the swap.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { parserRegistry } from "./registry.js"

// Pin the worker timezone BEFORE any parsing: the TS parsers construct Dates
// in MIXED conventions (alipay uses local components; ccb parses date-only
// strings as UTC midnight), so no single rendering is stable across runner
// timezones for both. With TZ=UTC set up front, local components equal UTC
// components and every Date construction becomes deterministic. (POSIX-only
// semantics — CI is ubuntu, dev is macOS; fine.)
process.env.TZ = "UTC"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

function fixturePath(...parts: string[]): string {
  return join(fixturesDir, ...parts)
}

/** Fixtures the TS registry is expected to detect (7-parser era). */
const TS_DETECTED_FIXTURES: Array<{ crate: string; file: string }> = [
  { crate: "cn-alipay", file: "sample.csv" },
  { crate: "cn-alipay-mobile", file: "sample.csv" },
  { crate: "cn-cmbc-credit", file: "sample.csv" },
  { crate: "cn-ccb-debit", file: "sample.csv" },
  { crate: "eu-degiro", file: "sample.csv" },
  { crate: "eu-interactive-brokers", file: "sample.csv" },
  { crate: "hk-hsbc-credit", file: "sample.csv" },
  { crate: "hk-hsbc-debit", file: "sample.csv" },
]

/**
 * Replace Date instances with their LOCAL-component string form before
 * snapshotting: vitest serializes Dates as UTC instants, so a baseline
 * recorded on a UTC+9 machine would fail on a UTC CI runner (the parsers
 * construct dates with local components). The local round-trip is
 * machine-independent and records the semantic content.
 */
function localDateString(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  )
}

function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) return localDateString(value)
  if (Array.isArray(value)) return value.map(normalizeDates)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = normalizeDates(v)
    return out
  }
  return value
}

describe("parity: TS-parser baseline (Layer 1)", () => {
  for (const { crate, file } of TS_DETECTED_FIXTURES) {
    it(`detects and parses ${crate}/${file} (pinned baseline)`, () => {
      const content = readFileSync(fixturePath(crate, file))

      const detected = parserRegistry.detect(content)
      expect(detected, `TS registry should detect ${crate}/${file}`).not.toBeNull()

      const parser = parserRegistry.get(detected!)
      const result = parser.parse(content)

      // Snapshot whatever the TS layer produces (success or failure) —
      // this is the reviewed pre-migration golden (dates normalized to
      // local-component strings so the baseline is timezone-stable).
      expect({ detected, result: normalizeDates(result) }).toMatchSnapshot()
    })
  }
})
