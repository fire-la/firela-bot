/**
 * Unit tests for the scheduled Plaid -> VLT sync job.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted guarantees these mocks exist before the hoisted vi.mock factories run.
const mocks = vi.hoisted(() => ({
  syncTransactions: vi.fn(),
  getVltJwt: vi.fn(),
  uploadTransactions: vi.fn(),
}))
const { syncTransactions: mockSyncTransactions, getVltJwt: mockGetVltJwt, uploadTransactions: mockUploadTransactions } = mocks

vi.mock("../lib/plaid-relay.js", () => ({
  getPlaidRelayClient: vi.fn(() =>
    Promise.resolve({ syncTransactions: mocks.syncTransactions }),
  ),
}))
vi.mock("../lib/vlt-auth.js", () => ({ getVltJwt: mocks.getVltJwt }))
vi.mock("@firela/billclaw-core", () => ({ uploadTransactions: mocks.uploadTransactions }))

// Real converter (pure) — exercise the actual mapping.
import { runSyncJob } from "./sync-job.js"

// --- in-memory KV fake ---

function makeKv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>()
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, typeof v === "string" ? v : JSON.stringify(v))
  }
  return {
    async get(key: string, opts?: unknown) {
      const raw = store.get(key)
      if (raw == null) return null
      if (opts === "json") {
        try {
          return JSON.parse(raw)
        } catch {
          return null
        }
      }
      return raw
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
    _raw: (key: string) => store.get(key) ?? null,
    _has: (key: string) => store.has(key),
  }
}

const VLT_CONFIG = {
  vlt: {
    apiUrl: "https://vlt.test/api/v1",
    accessToken: "vlt-long-lived",
    region: "us",
    upload: {
      mode: "auto",
      sourceAccount: "Assets:Bank",
      defaultCurrency: "USD",
      defaultExpenseAccount: "Expenses:Unknown",
      defaultIncomeAccount: "Income:Unknown",
      filterPending: true,
    },
  },
}

function plaidAccount(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Plaid ${id}`,
    provider: "plaid",
    type: "plaid",
    status: "connected",
    enabled: true,
    plaidAccessToken: `tok-${id}`,
    ...over,
  }
}

/** env with only CONFIG (runSyncJob + the mocked helpers need nothing else). */
function envWith(kv: ReturnType<typeof makeKv>) {
  return { CONFIG: kv } as never
}

/** Pull the uploaded txns array (2nd positional arg) from the first upload call. */
function firstUploadedTxns(): Array<Record<string, unknown>> {
  const calls = mockUploadTransactions.mock.calls as unknown[][]
  return calls[0]![1] as Array<Record<string, unknown>>
}

describe("runSyncJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetVltJwt.mockResolvedValue("vlt-jwt")
    mockUploadTransactions.mockResolvedValue({
      imported: 0,
      skipped: 0,
      pendingReview: 0,
      failed: 0,
    })
  })

  it("no-op when VLT auto-sync is not configured (no JWT, no upload)", async () => {
    const kv = makeKv({
      "billclaw:config": { vlt: { apiUrl: "x", upload: { mode: "manual", sourceAccount: "a" } } },
    })
    await runSyncJob(envWith(kv))
    expect(mockGetVltJwt).not.toHaveBeenCalled()
    expect(mockUploadTransactions).not.toHaveBeenCalled()
  })

  it("no-op when there are no enabled Plaid accounts", async () => {
    const kv = makeKv({
      "billclaw:config": VLT_CONFIG,
      "billclaw:accounts": [plaidAccount("a", { enabled: false })],
    })
    await runSyncJob(envWith(kv))
    expect(mockGetVltJwt).not.toHaveBeenCalled()
    expect(mockUploadTransactions).not.toHaveBeenCalled()
  })

  it("happy path: fetches, uploads, advances cursor, sets lastStatus ok, releases lock", async () => {
    mockSyncTransactions.mockResolvedValue({
      added: [{ transaction_id: "t1", account_id: "a", amount: 12.5, date: "2026-07-30", name: "Coffee", iso_currency_code: "USD" }],
      modified: [{ transaction_id: "t2", amount: -3, date: "2026-07-29", name: "Refund" }],
      removed: [],
      next_cursor: "cursor-2",
      has_more: false,
    })
    const kv = makeKv({
      "billclaw:config": VLT_CONFIG,
      "billclaw:accounts": [plaidAccount("a")],
    })
    await runSyncJob(envWith(kv))

    expect(mockGetVltJwt).toHaveBeenCalledTimes(1)
    expect(mockUploadTransactions).toHaveBeenCalledTimes(1)
    const txns = firstUploadedTxns()
    expect(txns).toHaveLength(2)
    expect(txns.find((t) => t.amount === 12.5)).toBeDefined()
    expect(txns.find((t) => t.amount === -3)?.iso_currency_code).toBe("USD")
    expect(kv._raw("billclaw:cursor:a")).toBe("cursor-2")
    expect(kv._has("sync_lock_a")).toBe(false)
    const accounts = JSON.parse(kv._raw("billclaw:accounts")!) as Array<{ lastStatus: string; lastSync: string }>
    expect(accounts[0]!.lastStatus).toBe("ok")
    expect(accounts[0]!.lastSync).toBeTruthy()
  })

  it("upload failure: cursor NOT advanced, lock released, lastStatus error", async () => {
    mockSyncTransactions.mockResolvedValue({
      added: [{ transaction_id: "t1", amount: 1, date: "2026-07-30", name: "x" }],
      modified: [],
      removed: [],
      next_cursor: "cursor-x",
      has_more: false,
    })
    mockUploadTransactions.mockRejectedValueOnce(new Error("vlt down"))
    const kv = makeKv({
      "billclaw:config": VLT_CONFIG,
      "billclaw:accounts": [plaidAccount("a")],
    })
    await runSyncJob(envWith(kv))

    expect(kv._raw("billclaw:cursor:a")).toBeNull()
    expect(kv._has("sync_lock_a")).toBe(false)
    const accounts = JSON.parse(kv._raw("billclaw:accounts")!) as Array<{ lastStatus: string }>
    expect(accounts[0]!.lastStatus).toBe("error")
  })

  it("one account fails, the other still syncs (Promise.all isolation)", async () => {
    mockSyncTransactions
      .mockResolvedValueOnce({ added: [{ transaction_id: "ta", amount: 1, date: "2026-07-30", name: "x" }], modified: [], removed: [], next_cursor: "cA", has_more: false })
      .mockResolvedValueOnce({ added: [{ transaction_id: "tb", amount: 2, date: "2026-07-30", name: "y" }], modified: [], removed: [], next_cursor: "cB", has_more: false })
    mockUploadTransactions
      .mockRejectedValueOnce(new Error("fail A"))
      .mockResolvedValueOnce({ imported: 1, skipped: 0, pendingReview: 0, failed: 0 })

    const kv = makeKv({
      "billclaw:config": VLT_CONFIG,
      "billclaw:accounts": [plaidAccount("a"), plaidAccount("b")],
    })
    await runSyncJob(envWith(kv))

    expect(kv._raw("billclaw:cursor:a")).toBeNull()
    expect(kv._raw("billclaw:cursor:b")).toBe("cB")
    const accounts = JSON.parse(kv._raw("billclaw:accounts")!) as Array<{ id: string; lastStatus: string }>
    expect(accounts.find((x) => x.id === "a")!.lastStatus).toBe("error")
    expect(accounts.find((x) => x.id === "b")!.lastStatus).toBe("ok")
  })

  it("lock held -> account skipped", async () => {
    const kv = makeKv({
      "billclaw:config": VLT_CONFIG,
      "billclaw:accounts": [plaidAccount("a")],
      sync_lock_a: { at: "now" },
    })
    await runSyncJob(envWith(kv))
    expect(mockSyncTransactions).not.toHaveBeenCalled()
    expect(mockUploadTransactions).not.toHaveBeenCalled()
    expect(kv._has("sync_lock_a")).toBe(true)
  })

  it("filterPending drops pending transactions before upload", async () => {
    mockSyncTransactions.mockResolvedValue({
      added: [
        { transaction_id: "p1", amount: 5, date: "2026-07-30", name: "pending", pending: true },
        { transaction_id: "p2", amount: 6, date: "2026-07-30", name: "posted" },
      ],
      modified: [],
      removed: [],
      next_cursor: "c",
      has_more: false,
    })
    const kv = makeKv({
      "billclaw:config": { ...VLT_CONFIG, vlt: { ...VLT_CONFIG.vlt, upload: { ...VLT_CONFIG.vlt.upload, filterPending: true } } },
      "billclaw:accounts": [plaidAccount("a")],
    })
    await runSyncJob(envWith(kv))
    expect(firstUploadedTxns().map((t) => t.transaction_id)).toEqual(["p2"])
  })

  it("JWT is fetched once for multiple accounts", async () => {
    mockSyncTransactions.mockResolvedValue({ added: [{ transaction_id: "t", amount: 1, date: "2026-07-30", name: "x" }], modified: [], removed: [], next_cursor: "c", has_more: false })
    const kv = makeKv({
      "billclaw:config": VLT_CONFIG,
      "billclaw:accounts": [plaidAccount("a"), plaidAccount("b"), plaidAccount("c")],
    })
    await runSyncJob(envWith(kv))
    expect(mockGetVltJwt).toHaveBeenCalledTimes(1)
    expect(mockUploadTransactions).toHaveBeenCalledTimes(3)
  })

  it("skips the VLT upload when there are no new transactions (cursor still advances)", async () => {
    mockSyncTransactions.mockResolvedValue({ added: [], modified: [], removed: [], next_cursor: "c-empty", has_more: false })
    const kv = makeKv({
      "billclaw:config": VLT_CONFIG,
      "billclaw:accounts": [plaidAccount("a")],
    })
    await runSyncJob(envWith(kv))
    expect(mockUploadTransactions).not.toHaveBeenCalled()
    expect(kv._raw("billclaw:cursor:a")).toBe("c-empty")
    const accounts = JSON.parse(kv._raw("billclaw:accounts")!) as Array<{ lastStatus: string }>
    expect(accounts[0]!.lastStatus).toBe("ok")
  })
})
