/**
 * Unit tests for the deployment-origin capture middleware (issue #33).
 *
 * The once-per-isolate module flag makes ordering stateful across requests —
 * each test re-imports a fresh module copy via vi.resetModules(). Requests
 * carry full URLs so the captured origin is the host under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"

beforeEach(() => {
  vi.resetModules()
})

async function makeApp(kv: Map<string, string>, failing = false) {
  const { captureDeploymentOrigin } = await import("./deployment-origin.js")
  const app = new Hono()
  app.use("*", captureDeploymentOrigin())
  app.get("/ping", (c) => c.text("pong"))
  app.env = {
    CONFIG: failing
      ? {
          get: vi.fn(async () => {
            throw new Error("KV unavailable")
          }),
          put: vi.fn(async () => {
            throw new Error("KV unavailable")
          }),
        }
      : {
          get: vi.fn(async (key: string) => kv.get(key) ?? null),
          put: vi.fn(async (key: string, value: string) => {
            kv.set(key, value)
          }),
        },
  } as never
  return app
}

describe("captureDeploymentOrigin", () => {
  it("captures the request origin into KV on the first request", async () => {
    const kv = new Map<string, string>()
    const app = await makeApp(kv)

    const res = await app.request("https://bc.example.com/ping", {}, app.env)
    expect(res.status).toBe(200)
    expect(kv.get("firela:deployment:origin")).toBe("https://bc.example.com")
  })

  it("an established custom origin is never displaced by another host", async () => {
    const kv = new Map<string, string>([
      ["firela:deployment:origin", "https://custom.example.com"],
    ])
    const app = await makeApp(kv)

    // Fresh module copy = fresh isolate; request arrives on a different host
    await app.request("https://other.example.org/ping", {}, app.env)
    expect(kv.get("firela:deployment:origin")).toBe("https://custom.example.com")
  })

  it("a *.workers.dev origin IS displaced by a custom domain", async () => {
    const kv = new Map<string, string>([
      ["firela:deployment:origin", "https://bc.workers.dev"],
    ])
    const app = await makeApp(kv)

    await app.request("https://bc.example.com/ping", {}, app.env)
    expect(kv.get("firela:deployment:origin")).toBe("https://bc.example.com")
  })

  it("KV failures are swallowed — the request still succeeds", async () => {
    const kv = new Map<string, string>()
    const app = await makeApp(kv, /* failing */ true)

    const res = await app.request("https://bc.example.com/ping", {}, app.env)
    expect(res.status).toBe(200)
    expect(kv.has("firela:deployment:origin")).toBe(false)
  })
})
