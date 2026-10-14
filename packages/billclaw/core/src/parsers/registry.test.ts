/**
 * Tests for Parser Registry
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  ParserRegistry,
  parserRegistry,
  PARSER_PLATFORM_CANONICAL,
  type ParserName,
} from "./registry.js"

describe("ParserRegistry", () => {
  let registry: ParserRegistry

  beforeEach(() => {
    registry = new ParserRegistry()
  })

  describe("list", () => {
    it("should return all available parser names", () => {
      const parsers = registry.list()
      expect(parsers).toContain("alipay-web")
      expect(parsers).toContain("alipay-mobile")
      expect(parsers).toContain("cmbc-credit")
      expect(parsers).toContain("ccb-debit")
      expect(parsers).toContain("hsbc-hk")
      expect(parsers).toContain("degiro")
      expect(parsers).toContain("interactive-brokers")
    })

    it("should return a non-empty array", () => {
      const parsers = registry.list()
      expect(parsers.length).toBeGreaterThan(0)
    })
  })

  describe("get", () => {
    it("should return parser instance for valid parser name", () => {
      const parser = registry.get("alipay-web")
      expect(parser).toBeDefined()
      expect(parser.identify).toBeDefined()
      expect(parser.parse).toBeDefined()
    })

    it("should throw error for invalid parser name", () => {
      expect(() => registry.get("invalid-parser" as ParserName)).toThrow(
        "Unknown parser: invalid-parser"
      )
    })

    it("should return different instances for multiple calls", () => {
      const parser1 = registry.get("alipay-web")
      const parser2 = registry.get("alipay-web")
      expect(parser1).not.toBe(parser2)
    })
  })

  describe("detect", () => {
    it("should return null for empty content", () => {
      const result = registry.detect(Buffer.from(""))
      expect(result).toBeNull()
    })

    it("should return null for unknown content", () => {
      const result = registry.detect(Buffer.from("random,text,that,is,not,csv"))
      expect(result).toBeNull()
    })

    it("should return null for random binary content", () => {
      const randomBuffer = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe])
      const result = registry.detect(randomBuffer)
      expect(result).toBeNull()
    })
  })
})

describe("parserRegistry (default instance)", () => {
  it("should be a ParserRegistry instance", () => {
    expect(parserRegistry).toBeInstanceOf(ParserRegistry)
  })

  it("should have list method", () => {
    expect(typeof parserRegistry.list).toBe("function")
  })

  it("should have get method", () => {
    expect(typeof parserRegistry.get).toBe("function")
  })

  it("should have detect method", () => {
    expect(typeof parserRegistry.detect).toBe("function")
  })
})

describe("PARSER_PLATFORM_CANONICAL", () => {
  // Pin the bridge copy against its single source of truth: vlt
  // prisma/seeds/platforms.seed.ts (PLATFORMS_DATA canonicals). A value
  // change here must be a deliberate sync with that seed (or the bot#44
  // crate-manifest switch deleting this table) — never a drive-by edit.
  // Trap: cmbc = China Minsheng Bank, NOT China Merchants Bank (cmb).
  it("pins the four CN parser canonicals (drift against vlt seed turns this red)", () => {
    expect(PARSER_PLATFORM_CANONICAL).toEqual({
      "alipay-web": "alipay",
      "alipay-mobile": "alipay",
      "cmbc-credit": "cmbc",
      "ccb-debit": "ccb",
    })
  })

  it("is exhaustive: every parser is either mapped or an explicitly known non-CN parser", () => {
    // A parser added to the registry WITHOUT a mapping decision here turns
    // this red — an unmapped CN parser would silently fall back to the
    // legacy plaid transport (including its sign inversion) in import.ts.
    const explicitlyNonCn: ParserName[] = ["hsbc-hk", "degiro", "interactive-brokers"]
    for (const name of parserRegistry.list()) {
      const mapped = PARSER_PLATFORM_CANONICAL[name] !== undefined
      const knownNonCn = explicitlyNonCn.includes(name)
      expect(
        mapped || knownNonCn,
        `parser '${name}' is neither in PARSER_PLATFORM_CANONICAL nor the explicit non-CN list`,
      ).toBe(true)
    }
  })
})
