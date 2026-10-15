/**
 * Parser parity tests (fire-la/firela-bot#44).
 *
 * Golden parity (fire-la/firela-bot#44): for EVERY vendored fixture, the
 * crate's parse() output deep-equals the crate's own frozen golden
 * (expected.json vendored from firela-sdk; eu-deutsche-bank asserts each
 * locale against its own golden). This pins bot-side wiring against the
 * crates' upstream goldens.
 *
 * The one-shot TS-parser baseline (Layer 1) lived here during the migration
 * PR only: its .snap diff against the baseline commit WAS the reviewed
 * before/after record (method→paymentMethod, customFields flattened into
 * metadata, Date→string, Decimal→string) and was retired once reviewed —
 * this golden layer is the single permanent pin.
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
 * Every vendored fixture parses (via its own crate, addressed directly)
 * to exactly the crate's frozen golden. eu-deutsche-bank asserts
 * each locale against its own golden file.
 */
describe("parity: crate goldens", () => {
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
