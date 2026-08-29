/**
 * Tests for pairing helpers. The buildPairingUrl expectations pin the
 * cross-repo pairing URL contract consumed by the firela app's QR scanner
 * and "paste pairing link" parser — change them only in lockstep.
 */
import { describe, it, expect } from "vitest"
import { buildPairingUrl, groupClaimCode, formatCountdown } from "./pairing.js"

describe("buildPairingUrl (cross-repo contract)", () => {
  it("builds {origin}/pair#code={rawCode} with the code in the fragment", () => {
    expect(buildPairingUrl("https://my.workers.dev", "7Q3KD9XR")).toBe(
      "https://my.workers.dev/pair#code=7Q3KD9XR",
    )
  })

  it("embeds the raw code without hyphen grouping", () => {
    const url = buildPairingUrl("https://w.example", "7Q3KD9XR")
    expect(url.endsWith("#code=7Q3KD9XR")).toBe(true)
    expect(url).not.toContain("-D9XR")
  })

  it("normalizes a trailing slash on the worker URL", () => {
    expect(buildPairingUrl("https://w.example/", "7Q3KD9XR")).toBe(
      "https://w.example/pair#code=7Q3KD9XR",
    )
  })
})

describe("groupClaimCode", () => {
  it("groups an 8-char code as XXXX-XXXX", () => {
    expect(groupClaimCode("7Q3KD9XR")).toBe("7Q3K-D9XR")
  })

  it("passes through codes that are not 8 chars", () => {
    expect(groupClaimCode("ABC")).toBe("ABC")
  })
})

describe("formatCountdown", () => {
  it("formats the full 10-minute TTL", () => {
    expect(formatCountdown(600000)).toBe("10:00")
  })

  it("zero-pads minutes and seconds", () => {
    expect(formatCountdown(59000)).toBe("00:59")
    expect(formatCountdown(301000)).toBe("05:01")
  })

  it("clamps negatives to 00:00", () => {
    expect(formatCountdown(-1)).toBe("00:00")
  })
})
