/**
 * Parser parity tests (fire-la/firela-bot#44).
 *
 * Layer 1 (TS-parser baseline, Commit A of the migration): ran the OLD TS
 * registry over the fixtures below, pinning the pre-migration output in the
 * committed snapshot file. Commit B swapped the registry onto the wasm
 * crates and regenerated the snapshots — the .snap diff between the two
 * commits is the reviewed before/after parity record (method→paymentMethod,
 * customFields flattened into metadata, Date→string, Decimal→string). This
 * layer is retired at the end of the migration PR; Layer 2 remains as the
 * single permanent pin.
 *
 * Layer 2 (permanent): for EVERY vendored fixture, the crate's parse()
 * output deep-equals the crate's own frozen golden (expected.json vendored
 * from firela-sdk; eu-deutsche-bank asserts each locale against its own
 * golden). This pins bot-side wiring against the crates' upstream goldens.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { parserRegistry } from "./registry.js"
import type { ParserName } from "./registry.js"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

function fixturePath(...parts: string[]): string {
  return join(fixturesDir, ...parts)
}

/**
 * Replace Date instances with their LOCAL-component string form before
 * snapshotting: vitest serializes Dates as UTC instants, so a baseline
 * recorded on one timezone would fail on another. The local round-trip is
 * machine-independent and records the semantic content. (Moot for crate
 * output — dates are strings — kept for the Layer 1 record and any future
 * Date-bearing shape.)
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

/** Fixtures that had a TS-parser predecessor (7-parser era) — Layer 1 set. */
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

describe("parity: crate baseline (Layer 1, post-swap regeneration)", () => {
  for (const { crate, file } of TS_DETECTED_FIXTURES) {
    it(`detects and parses ${crate}/${file} (pinned)`, async () => {
      const content = readFileSync(fixturePath(crate, file))

      const detected = await parserRegistry.detect(content)
      expect(detected, `registry should detect ${crate}/${file}`).not.toBeNull()

      const parser = parserRegistry.get(detected!)
      const result = await parser.parse(content)

      expect({ detected, result: normalizeDates(result) }).toMatchSnapshot()
    })
  }
})

/**
 * Layer 2: every vendored fixture parses (via its own crate, addressed
 * directly) to exactly the crate's frozen golden. eu-deutsche-bank asserts
 * each locale against its own golden file.
 */
describe("parity: crate goldens (Layer 2, permanent)", () => {
  const GOLDEN_MATRIX: Array<{ crate: ParserName; file: string; golden: string }> = [
    { crate: "cn-alipay", file: "sample.csv", golden: "expected.json" },
    { crate: "cn-alipay", file: "sample-gbk.csv", golden: "expected.json" },
    { crate: "cn-alipay-mobile", file: "sample.csv", golden: "expected.json" },
    { crate: "cn-alipay-yuebao", file: "sample.csv", golden: "expected.json" },
    { crate: "cn-alipay-yuebao", file: "sample-gbk.csv", golden: "expected.json" },
    { crate: "cn-wechat", file: "sample.csv", golden: "expected.json" },
    { crate: "cn-wechat-xlsx", file: "sample.xlsx", golden: "expected.json" },
    { crate: "cn-cmbc-credit", file: "sample.csv", golden: "expected.json" },
    { crate: "cn-boc-credit", file: "sample.html", golden: "expected.json" },
    { crate: "cn-icbc-credit", file: "sample.html", golden: "expected.json" },
    { crate: "cn-ccb-debit", file: "sample.csv", golden: "expected.json" },
    { crate: "eu-degiro", file: "sample.csv", golden: "expected.json" },
    { crate: "eu-deutsche-bank", file: "deutsche-bank-sample-de.csv", golden: "expected-de.json" },
    { crate: "eu-deutsche-bank", file: "deutsche-bank-sample-en.csv", golden: "expected-en.json" },
    { crate: "eu-interactive-brokers", file: "sample.csv", golden: "expected.json" },
    { crate: "hk-hsbc-credit", file: "sample.csv", golden: "expected.json" },
    { crate: "hk-hsbc-debit", file: "sample.csv", golden: "expected.json" },
  ]

  for (const { crate, file, golden } of GOLDEN_MATRIX) {
    it(`${crate}/${file} deep-equals its frozen golden`, async () => {
      const content = readFileSync(fixturePath(crate, file))
      const expected = JSON.parse(readFileSync(fixturePath(crate, golden), "utf-8"))

      const result = await parserRegistry.get(crate).parse(content)

      // Normalize undefined-vs-absent and Date-vs-string differences the
      // JSON golden cannot express.
      expect(JSON.parse(JSON.stringify(result))).toEqual(expected)
    })
  }
})
