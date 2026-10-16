/**
 * Unit tests for the scheduled webhook-registration job (issue #33).
 *
 * The relay client is mocked at the "@firela/billclaw-core/relay" specifier
 * (the one lib/relay-helpers.ts imports), so construction flows through the
 * real helper while the network call is stubbed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRegister = vi.fn()
vi.mock("@firela/billclaw-core/relay", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@firela/billclaw-core/relay")
  >()
  return {
    ...original,
    RelayClient: vi.fn().mockImplementation(() => ({
      registerWebhookCallback: mockRegister,
    })),
  }
})

import { RelayError } from "@firela/billclaw-core/relay"
import { runWebhookRegistrationJob } from "./webhook-registration-job.js"

function makeEnv(kv: Map<string, string>) {
  return {
    DB: {} as unknown as D1Database,
    CONFIG: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kv.set(key, value)
      }),
    } as unknown as KVNamespace,
  } as never
}

describe("runWebhookRegistrationJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("skips silently when no relay API key is configured", async () => {
    const kv = new Map<string, string>([["firela:deployment:origin", "https://bc.example.com"]])
    await runWebhookRegistrationJob(makeEnv(kv))
    expect(mockRegister).not.toHaveBeenCalled()
    expect(kv.has("firela:relay:webhook_registered_at")).toBe(false)
  })

  it("skips when no deployment origin has been captured yet", async () => {
    const kv = new Map<string, string>([["firela:relay:api_key", "fr-key"]])
    await runWebhookRegistrationJob(makeEnv(kv))
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it("registers the deployment origin + /webhook/plaid and stamps the success time", async () => {
    const kv = new Map<string, string>([
      ["firela:relay:api_key", "fr-key"],
      ["firela:deployment:origin", "https://bc.example.com"],
    ])
    mockRegister.mockResolvedValue({ status: "ok", registered: true, account_id: "3-5" })

    await runWebhookRegistrationJob(makeEnv(kv))

    expect(mockRegister).toHaveBeenCalledWith(
      "https://bc.example.com/webhook/plaid",
    )
    expect(kv.get("firela:relay:webhook_registered_at")).toBeTruthy()
  })

  it("a real-shape 403 (RelayError RELAY_FORBIDDEN, key lacks openbanking scope) is logged, never thrown", async () => {
    const kv = new Map<string, string>([
      ["firela:relay:api_key", "fr-key"],
      ["firela:deployment:origin", "https://bc.example.com"],
    ])
    // Mirror what parseRelayError actually produces for a 403: a RelayError
    // with code RELAY_FORBIDDEN and a message without "HTTP 403" in it.
    mockRegister.mockRejectedValue(
      new RelayError(
        "RELAY_FORBIDDEN",
        "Access forbidden: insufficient scope: openbanking",
        "Access denied by relay",
      ),
    )
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(runWebhookRegistrationJob(makeEnv(kv))).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("openbanking scope"),
      expect.any(String),
    )
    expect(kv.has("firela:relay:webhook_registered_at")).toBe(false)
    errorSpy.mockRestore()
  })

  it("a network failure is logged, never thrown (cron safety)", async () => {
    const kv = new Map<string, string>([
      ["firela:relay:api_key", "fr-key"],
      ["firela:deployment:origin", "https://bc.example.com"],
    ])
    mockRegister.mockRejectedValue(new Error("ECONNREFUSED"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(runWebhookRegistrationJob(makeEnv(kv))).resolves.toBeUndefined()
    errorSpy.mockRestore()
  })
})
