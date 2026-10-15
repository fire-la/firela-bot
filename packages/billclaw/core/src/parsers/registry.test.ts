/**
 * Tests for the wasm-crate Parser Registry (fire-la/firela-bot#44).
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  parserRegistry,
  PARSER_PLATFORM_CANONICAL,
  PARSER_ALIASES,
  resolveParserName,
  type ParserName,
} from "./registry.js"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

function fixture(...parts: string[]): Buffer {
  return readFileSync(join(fixturesDir, ...parts))
}

const ALL_PARSERS: ParserName[] = [
  "cn-alipay",
  "cn-alipay-mobile",
  "cn-alipay-yuebao",
  "cn-wechat",
  "cn-wechat-xlsx",
  "cn-cmbc-credit",
  "cn-boc-credit",
  "cn-icbc-credit",
  "cn-ccb-debit",
  "eu-degiro",
  "eu-deutsche-bank",
  "eu-interactive-brokers",
  "hk-hsbc-credit",
  "hk-hsbc-debit",
]

describe("ParserRegistry", () => {
  describe("list", () => {
    it("returns all 14 crate parser names", () => {
      expect(parserRegistry.list().sort()).toEqual([...ALL_PARSERS].sort())
    })
  })

  describe("get", () => {
    it("returns the crate module surface for a valid name", () => {
      const parser = parserRegistry.get("cn-alipay-mobile")
      expect(typeof parser.parse).toBe("function")
      expect(typeof parser.detect).toBe("function")
    })

    it("throws for an unknown name", () => {
      expect(() => parserRegistry.get("invalid-parser" as ParserName)).toThrow(
        "Unknown parser: invalid-parser",
      )
    })
  })

  describe("transport (bot#45 ruling)", () => {
    it("routes every cn-* parser to parsed-bill with a platform canonical", () => {
      for (const name of parserRegistry.list()) {
        const transport = parserRegistry.transport(name)
        if (name.startsWith("cn-")) {
          expect(transport, `${name} should ride parsed-bill`).toBe("parsed-bill")
          expect(
            PARSER_PLATFORM_CANONICAL[name],
            `${name} must have a platform canonical on the parsed-bill leg`,
          ).toBeDefined()
        } else {
          expect(transport, `${name} should ride plaid`).toBe("plaid")
          expect(
            PARSER_PLATFORM_CANONICAL[name],
            `non-CN ${name} must NOT appear in the platform table (platform presence is not the transport discriminator)`,
          ).toBeUndefined()
        }
      }
    })

    it("throws for an unknown name", () => {
      expect(() => parserRegistry.transport("nope" as ParserName)).toThrow(
        "Unknown parser: nope",
      )
    })
  })

  describe("detect", () => {
    it("returns null for empty content", async () => {
      expect(await parserRegistry.detect(Buffer.from(""))).toBeNull()
    })

    it("returns null for unknown text", async () => {
      expect(await parserRegistry.detect(Buffer.from("random,text,not,a,bill"))).toBeNull()
    })

    it("returns null for random binary", async () => {
      expect(
        await parserRegistry.detect(Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe])),
      ).toBeNull()
    })

    /**
     * Fan-out matrix: every vendored fixture must auto-detect to its own
     * crate. This subsumes the one reachable 100/100 tie in the corpus —
     * eu-deutsche-bank EN CSVs also satisfy eu-interactive-brokers'
     * contains-predicate, and the registry's declaration order (DB before
     * IB) must win it for DB.
     */
    const DETECT_MATRIX: Array<{ crate: string; file: string; expect: ParserName }> = [
      { crate: "cn-alipay", file: "sample.csv", expect: "cn-alipay" },
      { crate: "cn-alipay", file: "sample-gbk.csv", expect: "cn-alipay" },
      { crate: "cn-alipay-mobile", file: "sample.csv", expect: "cn-alipay-mobile" },
      { crate: "cn-alipay-yuebao", file: "sample.csv", expect: "cn-alipay-yuebao" },
      { crate: "cn-alipay-yuebao", file: "sample-gbk.csv", expect: "cn-alipay-yuebao" },
      { crate: "cn-wechat", file: "sample.csv", expect: "cn-wechat" },
      { crate: "cn-wechat-xlsx", file: "sample.xlsx", expect: "cn-wechat-xlsx" },
      { crate: "cn-cmbc-credit", file: "sample.csv", expect: "cn-cmbc-credit" },
      { crate: "cn-boc-credit", file: "sample.html", expect: "cn-boc-credit" },
      { crate: "cn-icbc-credit", file: "sample.html", expect: "cn-icbc-credit" },
      { crate: "cn-ccb-debit", file: "sample.csv", expect: "cn-ccb-debit" },
      { crate: "eu-degiro", file: "sample.csv", expect: "eu-degiro" },
      { crate: "eu-deutsche-bank", file: "deutsche-bank-sample-de.csv", expect: "eu-deutsche-bank" },
      { crate: "eu-deutsche-bank", file: "deutsche-bank-sample-en.csv", expect: "eu-deutsche-bank" },
      { crate: "eu-interactive-brokers", file: "sample.csv", expect: "eu-interactive-brokers" },
      { crate: "hk-hsbc-credit", file: "sample.csv", expect: "hk-hsbc-credit" },
      { crate: "hk-hsbc-debit", file: "sample.csv", expect: "hk-hsbc-debit" },
    ]

    for (const { crate, file, expect: expected } of DETECT_MATRIX) {
      it(`detects ${crate}/${file} as ${expected}`, async () => {
        const detected = await parserRegistry.detect(fixture(crate, file))
        expect(detected).toBe(expected)
      })
    }
  })
})

describe("resolveParserName", () => {
  it("passes valid crate names through", () => {
    expect(resolveParserName("cn-alipay")).toBe("cn-alipay")
    expect(resolveParserName("hk-hsbc-debit")).toBe("hk-hsbc-debit")
  })

  it("resolves all legacy aliases", () => {
    expect(PARSER_ALIASES).toEqual({
      "alipay-web": "cn-alipay",
      "alipay-mobile": "cn-alipay-mobile",
      "cmbc-credit": "cn-cmbc-credit",
      "ccb-debit": "cn-ccb-debit",
      degiro: "eu-degiro",
      "interactive-brokers": "eu-interactive-brokers",
    })
    for (const [alias, canonical] of Object.entries(PARSER_ALIASES)) {
      expect(resolveParserName(alias)).toBe(canonical)
    }
  })

  it("errors on the split hsbc-hk alias, naming both successors", () => {
    expect(() => resolveParserName("hsbc-hk")).toThrow(/hk-hsbc-credit.*hk-hsbc-debit|hk-hsbc-debit.*hk-hsbc-credit/s)
  })

  it("errors on an unknown name, listing the choices", () => {
    expect(() => resolveParserName("made-up")).toThrow(
      /Unknown parser: made-up.*cn-alipay/s,
    )
  })
})

describe("PARSER_PLATFORM_CANONICAL", () => {
  // Pin the bridge copy against its single source of truth chain: vlt
  // platforms.seed.ts (PLATFORMS_DATA) -> crate Cargo.toml
  // [package.metadata.firela] (keyed at crate 0.1.11). A value change here
  // must be a deliberate sync with that chain — never a drive-by edit.
  // Trap: cmb = China Merchants Bank (no bot parser), cmbc = China Minsheng
  // Bank; wechat canonical is wechat-pay (not wechat).
  it("pins the nine CN crate canonicals (drift against the vlt seed turns this red)", () => {
    expect(PARSER_PLATFORM_CANONICAL).toEqual({
      "cn-alipay": "alipay",
      "cn-alipay-mobile": "alipay",
      "cn-alipay-yuebao": "alipay",
      "cn-wechat": "wechat-pay",
      "cn-wechat-xlsx": "wechat-pay",
      "cn-cmbc-credit": "cmbc",
      "cn-boc-credit": "boc",
      "cn-icbc-credit": "icbc",
      "cn-ccb-debit": "ccb",
    })
  })
})
