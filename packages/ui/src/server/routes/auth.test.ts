/**
 * Auth route tests — POST /auth/setup state machine (issue #26 bundled fix)
 * plus the anonymous-oracle throttle (issue #29 precondition).
 *
 * /auth/setup doubles as SPA login and first-caller setup. The ownerless
 * closure added for Track C: once a deployment has a redeemed app (bootstrap
 * done) and a live pairing record, anonymous first-caller setup must be
 * rejected — ownership is established from the paired app
 * (POST /api/pair/establish-owner) instead. A fully abandoned deployment
 * (every record expired or revoked) keeps the first-caller recovery path.
 *
 * The throttle: wrong passwords on the login path count into the shared
 * pair_proof_throttle D1 counter (keyed `setup:<client-ip>`), same 5-free
 * failures + exponential backoff as the app proof path.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest"
import { Hono } from "hono"

import { authRoutes } from "./auth.js"
import { timingSafeEqualStr } from "../lib/auth-helpers.js"
import {
  PAIR_APP_PREFIX,
  PAIR_BOOTSTRAP_DONE_KEY,
  SETUP_PASSWORD_KEY,
} from "../constants.js"
import { makeD1 } from "../../test/fake-d1.js"
import type { Env } from "../index.js"

// Minimal in-memory KV fake (get/put/list — hasLivePairedApp walks the list).
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
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? ""
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort()
      return { keys: names.map((name) => ({ name })), list_complete: true }
    },
    _raw: (k: string) => store.get(k) ?? null,
  }
}

/** Hono app mounting only authRoutes (PUBLIC_PATHS covers /auth — no middleware). */
function authApp() {
  const app = new Hono<{ Bindings: Env }>()
  app.route("/auth", authRoutes)
  return app
}

function setup(
  kv: ReturnType<typeof makeKv>,
  db: ReturnType<typeof makeD1>,
  password: string,
  ip?: string,
) {
  return authApp().request(
    "/auth/setup",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ip ? { "CF-Connecting-IP": ip } : {}),
      },
      body: JSON.stringify({ password }),
    },
    { CONFIG: kv, DB: db } as never,
  )
}

const DONE = { appId: "app-1", completedAt: 1 }
const LIVE_APP = { appId: "app-1", pairedAt: 1, revoked: false }
const REVOKED_APP = { appId: "app-1", pairedAt: 1, revoked: true }

describe("POST /auth/setup", () => {
  it("fresh deployment: first caller sets the password and gets an owner token", async () => {
    const kv = makeKv()
    const res = await setup(kv, makeD1(), "first-password")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; token: string }
    expect(body.success).toBe(true)
    expect(body.token.split(".").length).toBe(3)
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBe("first-password")
  })

  it("ownerless closure: 403 SETUP_CLOSED when bootstrap is done and a live app exists", async () => {
    const kv = makeKv({
      [PAIR_BOOTSTRAP_DONE_KEY]: DONE,
      [PAIR_APP_PREFIX + "app-1"]: LIVE_APP,
    })
    const res = await setup(kv, makeD1(), "attacker-password")
    expect(res.status).toBe(403)
    expect(((await res.json()) as { errorCode: string }).errorCode).toBe(
      "SETUP_CLOSED",
    )
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBeNull() // nothing stored
  })

  it("abandoned deployment (only revoked records) keeps the recovery path", async () => {
    const kv = makeKv({
      [PAIR_BOOTSTRAP_DONE_KEY]: DONE,
      [PAIR_APP_PREFIX + "app-1"]: REVOKED_APP,
    })
    const res = await setup(kv, makeD1(), "recovery-password")
    expect(res.status).toBe(200)
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBe("recovery-password")
  })

  it("abandoned deployment (KV records all expired) keeps the recovery path", async () => {
    const kv = makeKv({ [PAIR_BOOTSTRAP_DONE_KEY]: DONE })
    const res = await setup(kv, makeD1(), "recovery-password")
    expect(res.status).toBe(200)
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBe("recovery-password")
  })

  it("password set: wrong password 401 and unchanged, correct password logs in", async () => {
    const kv = makeKv({ [SETUP_PASSWORD_KEY]: "stored" })
    const db = makeD1()
    const wrong = await setup(kv, db, "nope")
    expect(wrong.status).toBe(401)
    expect(((await wrong.json()) as { errorCode: string }).errorCode).toBe(
      "SETUP_INVALID_PASSWORD",
    )
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBe("stored")

    const right = await setup(kv, db, "stored")
    expect(right.status).toBe(200)
    expect(((await right.json()) as { token: string }).token).toBeTruthy()
  })
})

describe("POST /auth/setup anonymous-oracle throttle", () => {
  it("5 wrong passwords lock the 6th attempt out with 429 SETUP_THROTTLED", async () => {
    const kv = makeKv({ [SETUP_PASSWORD_KEY]: "stored" })
    const db = makeD1()
    for (let i = 0; i < 5; i++) {
      const res = await setup(kv, db, "wrong-" + i, "203.0.113.9")
      expect(res.status).toBe(401)
    }
    const locked = await setup(kv, db, "stored", "203.0.113.9") // even the right one
    expect(locked.status).toBe(429)
    const body = (await locked.json()) as { errorCode: string; retryAfter: number }
    expect(body.errorCode).toBe("SETUP_THROTTLED")
    expect(body.retryAfter).toBeGreaterThan(0)
  })

  it("a successful login clears the failure counter", async () => {
    const kv = makeKv({ [SETUP_PASSWORD_KEY]: "stored" })
    const db = makeD1()
    for (let i = 0; i < 4; i++) {
      expect((await setup(kv, db, "nope", "198.51.100.7")).status).toBe(401)
    }
    expect((await setup(kv, db, "stored", "198.51.100.7")).status).toBe(200)
    // Counter was cleared, so one more wrong attempt is a fresh 401 — not a lock.
    expect((await setup(kv, db, "nope", "198.51.100.7")).status).toBe(401)
  })

  it("throttle buckets are per client IP", async () => {
    const kv = makeKv({ [SETUP_PASSWORD_KEY]: "stored" })
    const db = makeD1()
    for (let i = 0; i < 5; i++) {
      expect((await setup(kv, db, "nope", "192.0.2.1")).status).toBe(401)
    }
    expect((await setup(kv, db, "nope", "192.0.2.1")).status).toBe(429)
    // A different IP is a different bucket and logs in fine.
    expect((await setup(kv, db, "stored", "192.0.2.2")).status).toBe(200)
  })
})

describe("timingSafeEqualStr", () => {
  it("equal strings match", async () => {
    expect(await timingSafeEqualStr("hunter2", "hunter2")).toBe(true)
  })

  it("different strings of equal length differ", async () => {
    expect(await timingSafeEqualStr("hunterA", "hunterB")).toBe(false)
  })

  it("different lengths differ (no length-throw, no early exit shortcut)", async () => {
    expect(await timingSafeEqualStr("abc", "abcd")).toBe(false)
    expect(await timingSafeEqualStr("", "x")).toBe(false)
  })
})
