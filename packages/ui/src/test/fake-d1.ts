/**
 * In-memory fake of the D1 `pair_claim` statements issued by pair-helpers.ts
 * and routes/pair.ts — a statement matcher, NOT a SQL engine. Mirrors the
 * makeKv house style (Map-backed, `_`-prefixed oracles), shared by
 * pair.test.ts and bootstrap.test.ts.
 *
 * KEY PROPERTY: the UPDATE predicate is evaluated and applied synchronously
 * inside run() (an async function body runs sync to its first await, and there
 * is none before the mutation). Single-threaded execution then serializes the
 * two statements of a concurrent redeem exactly like D1 serializes single
 * statements — which is what makes the concurrency spec deterministic
 * (200 + 409) and what catches a regression to read-check-write
 * (both first() reads happen before either UPDATE runs -> 200 + 200).
 */

export type PairClaimRow = {
  code: string
  status: string
  origin: string | null
  created_at: number
  app_id: string | null
  redeemed_at: number | null
}

export type PairProofThrottleRow = {
  app_id: string
  failures: number
  locked_until: number
}

type Bound = {
  bind: (...values: unknown[]) => Bound
  run: () => Promise<{ success: true; meta: { changes: number } }>
  first: <T>() => Promise<T | null> // whole row returned; callers read their subset
}

/**
 * Seed rows by code; partials default to a fresh pending claim
 * (status "pending", created_at now, NULL origin/app_id/redeemed_at).
 */
export function makeD1(
  initial: Record<string, Partial<PairClaimRow>> = {},
  throttle: Record<string, Partial<PairProofThrottleRow>> = {},
) {
  const rows = new Map<string, PairClaimRow>()
  for (const [code, seed] of Object.entries(initial)) {
    rows.set(code, {
      code,
      status: seed.status ?? "pending",
      origin: seed.origin ?? null,
      created_at: seed.created_at ?? Math.floor(Date.now() / 1000),
      app_id: seed.app_id ?? null,
      redeemed_at: seed.redeemed_at ?? null,
    })
  }

  // Owner-password proof throttle rows (issue #26), keyed by app_id.
  const throttleRows = new Map<string, PairProofThrottleRow>()
  for (const [appId, seed] of Object.entries(throttle)) {
    throttleRows.set(appId, {
      app_id: appId,
      failures: seed.failures ?? 0,
      locked_until: seed.locked_until ?? 0,
    })
  }

  // Real D1 statements are runnable with or without a prior bind() — the fake
  // mirrors that by returning the full chain shape from prepare().
  function prepare(sql: string): Bound {
    function makeBound(s: string, values: unknown[]): Bound {
      // includes(), not startsWith(): real statements are multi-line template
      // literals with leading whitespace.
      const lc = s.toLowerCase()
      return {
        bind: (...next: unknown[]) => makeBound(s, [...values, ...next]),
        // Predicate + mutation applied synchronously here — see header note.
        run: () => {
          if (lc.includes("create table")) {
            return Promise.resolve({ success: true, meta: { changes: 0 } })
          }
          if (lc.includes("insert into pair_claim")) {
            const [code, status, origin, createdAt] = values as [string, string, string | null, number]
            rows.set(code, {
              code,
              status,
              origin,
              created_at: createdAt,
              app_id: null,
              redeemed_at: null,
            })
            return Promise.resolve({ success: true, meta: { changes: 1 } })
          }
          if (lc.includes("update pair_claim set status")) {
            // UPDATE pair_claim SET status=?1, app_id=?2, redeemed_at=?3
            //   WHERE code=?4 AND status='pending' AND created_at > ?5
            const [status, appId, redeemedAt, code, cutoff] = values as [
              string, string, number, string, number,
            ]
            const row = rows.get(code)
            if (row && row.status === "pending" && row.created_at > cutoff) {
              row.status = status
              row.app_id = appId
              row.redeemed_at = redeemedAt
              return Promise.resolve({ success: true, meta: { changes: 1 } })
            }
            return Promise.resolve({ success: true, meta: { changes: 0 } })
          }
          if (lc.includes("delete from pair_claim")) {
            const [cutoff] = values as [number]
            let changes = 0
            for (const [code, row] of rows) {
              if (row.created_at < cutoff) {
                rows.delete(code)
                changes++
              }
            }
            return Promise.resolve({ success: true, meta: { changes } })
          }
          // INSERT INTO pair_proof_throttle ... ON CONFLICT(app_id) DO UPDATE
          // SET failures = ?2, locked_until = ?3 — a straight upsert with
          // JS-computed values (the read-then-upsert race is documented as
          // tolerable in pair-helpers).
          if (lc.includes("insert into pair_proof_throttle")) {
            const [appId, failures, lockedUntil] = values as [
              string, number, number,
            ]
            throttleRows.set(appId, {
              app_id: appId,
              failures,
              locked_until: lockedUntil,
            })
            return Promise.resolve({ success: true, meta: { changes: 1 } })
          }
          if (lc.includes("delete from pair_proof_throttle")) {
            const [appId] = values as [string]
            return Promise.resolve({
              success: true,
              meta: { changes: throttleRows.delete(appId) ? 1 : 0 },
            })
          }
          throw new Error(`fake-d1: unexpected statement: ${s}`)
        },
        first: <T>() => {
          if (lc.includes("from pair_claim where code")) {
            // SELECT ... FROM pair_claim WHERE code = ?1 — return the whole
            // row; each caller reads its own column subset.
            const [code] = values as [string]
            return Promise.resolve((rows.get(code) ?? null) as T | null)
          }
          if (lc.includes("from pair_proof_throttle where app_id")) {
            const [appId] = values as [string]
            return Promise.resolve((throttleRows.get(appId) ?? null) as T | null)
          }
          throw new Error(`fake-d1: unexpected statement: ${s}`)
        },
      }
    }
    return makeBound(sql, [])
  }

  return {
    prepare,
    /** Oracle: one row by code (undefined if absent). */
    _row: (code: string) => rows.get(code),
    /** Oracle: all rows as an array. */
    _rows: () => [...rows.values()],
    /** Oracle: one throttle row by app_id (undefined if absent). */
    _throttle: (appId: string) => throttleRows.get(appId),
  }
}
