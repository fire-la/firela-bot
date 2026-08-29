/**
 * Auth route tests — POST /auth/setup state machine (issue #26 bundled fix).
 *
 * /auth/setup doubles as SPA login and first-caller setup. The ownerless
 * closure added for Track C: once a deployment has a redeemed app (bootstrap
 * done) and a live pairing record, anonymous first-caller setup must be
 * rejected — ownership is established from the paired app
 * (POST /api/pair/establish-owner) instead. A fully abandoned deployment
 * (every record expired or revoked) keeps the first-caller recovery path.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from "vitest"
import { Hono } from "hono"

import { authRoutes } from "./auth.js"
import {
  PAIR_APP_PREFIX,
  PAIR_BOOTSTRAP_DONE_KEY,
  SETUP_PASSWORD_KEY,
} from "../constants.js"
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

function setup(kv: ReturnType<typeof makeKv>, password: string) {
  return authApp().request(
    "/auth/setup",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    },
    { CONFIG: kv } as never,
  )
}

const DONE = { appId: "app-1", completedAt: 1 }
const LIVE_APP = { appId: "app-1", pairedAt: 1, revoked: false }
const REVOKED_APP = { appId: "app-1", pairedAt: 1, revoked: true }

describe("POST /auth/setup", () => {
  it("fresh deployment: first caller sets the password and gets an owner token", async () => {
    const kv = makeKv()
    const res = await setup(kv, "first-password")
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
    const res = await setup(kv, "attacker-password")
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
    const res = await setup(kv, "recovery-password")
    expect(res.status).toBe(200)
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBe("recovery-password")
  })

  it("abandoned deployment (KV records all expired) keeps the recovery path", async () => {
    const kv = makeKv({ [PAIR_BOOTSTRAP_DONE_KEY]: DONE })
    const res = await setup(kv, "recovery-password")
    expect(res.status).toBe(200)
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBe("recovery-password")
  })

  it("password set: wrong password 401 and unchanged, correct password logs in", async () => {
    const kv = makeKv({ [SETUP_PASSWORD_KEY]: "stored" })
    const wrong = await setup(kv, "nope")
    expect(wrong.status).toBe(401)
    expect(((await wrong.json()) as { errorCode: string }).errorCode).toBe(
      "SETUP_INVALID_PASSWORD",
    )
    expect(kv._raw(SETUP_PASSWORD_KEY)).toBe("stored")

    const right = await setup(kv, "stored")
    expect(right.status).toBe(200)
    expect(((await right.json()) as { token: string }).token).toBeTruthy()
  })
})
