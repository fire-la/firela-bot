/**
 * Fault-containment test for the registry's detect fan-out (bot#44): a crate
 * whose detect() REJECTS — the wasm loaders reject stickily when
 * instantiation fails — must simply cast no vote, not kill auto-detection.
 *
 * Lives in its own file because vi.mock is module-wide: only this suite runs
 * with @firela/cn-alipay patched to a rejecting crate.
 */

import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

vi.mock("@firela/cn-alipay", () => ({
  parse: vi.fn().mockRejectedValue(new Error("wasm instantiate failed")),
  detect: vi.fn().mockRejectedValue(new Error("wasm instantiate failed")),
}))

import { parserRegistry } from "./registry.js"

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

describe("ParserRegistry detect fault containment", () => {
  it("degrades a rejecting crate to no vote and still detects the healthy crate", async () => {
    // cn-alipay's detect() rejects (mocked); cn-alipay-mobile's fixture must
    // still auto-detect through the remaining crates.
    const content = readFileSync(join(fixturesDir, "cn-alipay-mobile", "sample.csv"))
    const detected = await parserRegistry.detect(content)
    expect(detected).toBe("cn-alipay-mobile")
  })

  it("never returns the broken crate and never rejects when it would have won", async () => {
    // cn-alipay's fixture is the broken crate's own; whether detect degrades
    // to null or another crate's partial vote wins, the broken crate must
    // not win and the fan-out must not reject.
    const content = readFileSync(join(fixturesDir, "cn-alipay", "sample.csv"))
    const detected = await parserRegistry.detect(content)
    expect(detected).not.toBe("cn-alipay")
  })
})
