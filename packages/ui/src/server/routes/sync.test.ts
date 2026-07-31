/**
 * Unit tests for the manual sync trigger route.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({ runSyncJob: vi.fn() }))
vi.mock("../jobs/sync-job.js", () => ({ runSyncJob: mocks.runSyncJob }))

import { syncRoutes } from "./sync.js"

// runSyncJob only reads c.env; the route passes it straight through.
const env = { CONFIG: {} } as never

/** Fake execution context whose waitUntil swallows rejections (like the runtime). */
function makeCtx() {
  return {
    waitUntil: vi.fn((p: Promise<unknown>) => {
      void p.catch(() => {})
    }),
    passThroughOnException: vi.fn(),
  }
}

describe("POST /api/sync/run", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runSyncJob.mockResolvedValue(undefined)
  })

  it("fires runSyncJob via waitUntil and returns 200 immediately", async () => {
    const ctx = makeCtx()
    const res = await syncRoutes.request(
      "/run",
      { method: "POST" },
      env,
      ctx as never,
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; message: string }
    expect(body.success).toBe(true)

    // runSyncJob was invoked once with the env, and handed to waitUntil
    // (fire-and-forget — NOT awaited inline).
    expect(mocks.runSyncJob).toHaveBeenCalledTimes(1)
    expect(mocks.runSyncJob).toHaveBeenCalledWith(env)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
  })

  it("still returns 200 when runSyncJob rejects (failure surfaces via status)", async () => {
    mocks.runSyncJob.mockRejectedValue(new Error("boom"))
    const ctx = makeCtx()
    const res = await syncRoutes.request(
      "/run",
      { method: "POST" },
      env,
      ctx as never,
    )

    expect(res.status).toBe(200)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
  })
})
