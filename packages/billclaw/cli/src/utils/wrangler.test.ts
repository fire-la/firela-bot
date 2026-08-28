/**
 * Tests for temporary-session cache in wrangler deploy utilities
 */

import { describe, it, expect, afterEach } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  readTempSessionCache,
  isTempCacheFresh,
} from "./wrangler.js"

describe("temporary-session cache", () => {
  const tmpDirs: string[] = []

  function cachePath(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "billclaw-cache-test-"))
    tmpDirs.push(dir)
    return path.join(dir, "cache.json")
  }

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("returns null when no cache file exists", () => {
    expect(readTempSessionCache(cachePath())).toBeNull()
  })

  it("returns null for invalid JSON", () => {
    const filePath = cachePath()
    writeFileSync(filePath, "not json {")
    expect(readTempSessionCache(filePath)).toBeNull()
  })

  it("returns null when createdAt is missing", () => {
    const filePath = cachePath()
    writeFileSync(filePath, JSON.stringify({ kvNamespaceId: "abc" }))
    expect(readTempSessionCache(filePath)).toBeNull()
  })

  it("reads back a well-formed cache", () => {
    const filePath = cachePath()
    writeFileSync(
      filePath,
      JSON.stringify({ kvNamespaceId: "abc123", createdAt: 1000 }),
    )
    expect(readTempSessionCache(filePath)).toEqual({
      kvNamespaceId: "abc123",
      createdAt: 1000,
    })
  })

  it("treats entries older than the claim window as stale", () => {
    expect(isTempCacheFresh({ createdAt: 0 }, 49 * 60 * 1000)).toBe(true)
    expect(isTempCacheFresh({ createdAt: 0 }, 51 * 60 * 1000)).toBe(false)
  })
})
