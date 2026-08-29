/**
 * Tests for VLT API client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { VltClient, uploadTransactions } from "./vlt-client.js"
import type { Logger } from "../errors/errors.js"

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

// Mock logger
const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}

describe("VltClient", () => {
  let client: VltClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new VltClient(
      {
        apiUrl: "http://localhost:3000/api/v1",
        apiToken: "test-token",
        region: "us",
      },
      mockLogger,
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("should instantiate with config", () => {
    expect(client).toBeDefined()
  })

  it("should add Authorization header to requests", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ providers: ["plaid"] }),
    })

    await client.checkSupported()

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/us/bean/import/provider/plaid/supported",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    )
  })

  it("should retry on 5xx errors", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: ["plaid"] }),
      })

    await client.checkSupported()

    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("should not retry on 401 errors", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    })

    // checkSupported catches errors and returns false
    const result = await client.checkSupported()
    expect(result).toBe(false)

    // Should only call once (no retry for auth errors)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("should not retry on 403 errors", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    })

    // checkSupported catches errors and returns false
    const result = await client.checkSupported()
    expect(result).toBe(false)

    // Should only call once (no retry for auth errors)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("should upload transactions with sync method", async () => {
    const mockResponse = {
      imported: 5,
      skipped: 2,
      pendingReview: 1,
      failed: 0,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const transactions = [
      {
        transaction_id: "txn-1",
        amount: 100.0,
        iso_currency_code: "USD",
        date: "2024-01-01",
        name: "Test Transaction",
        pending: false,
        account_id: "acc-1",
      },
    ]

    const result = await client.sync(transactions, {
      sourceAccount: "Assets:Bank",
      defaultCurrency: "USD",
      defaultExpenseAccount: "Expenses:Unknown",
      defaultIncomeAccount: "Income:Unknown",
    })

    expect(result.imported).toBe(5)
    expect(result.skipped).toBe(2)
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/us/bean/import/provider/plaid/sync",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("config"),
      }),
    )
  })

  it("should forward externalAccountId to config when provided (ADR-0113 #17)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ imported: 0, skipped: 0, pendingReview: 0, failed: 0 }),
    })

    await client.sync(
      [
        {
          transaction_id: "txn-1",
          amount: 1,
          iso_currency_code: "USD",
          date: "2024-01-01",
          name: "T",
          pending: false,
          account_id: "acc-1",
        },
      ],
      {
        sourceAccount: "Assets:Bank",
        defaultCurrency: "USD",
        defaultExpenseAccount: "Expenses:Unknown",
        defaultIncomeAccount: "Income:Unknown",
        externalAccountId: "ext-acct-1",
      },
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.config.externalAccountId).toBe("ext-acct-1")
  })

  it("should omit externalAccountId from config when not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ imported: 0, skipped: 0, pendingReview: 0, failed: 0 }),
    })

    await client.sync(
      [
        {
          transaction_id: "txn-1",
          amount: 1,
          iso_currency_code: "USD",
          date: "2024-01-01",
          name: "T",
          pending: false,
          account_id: "acc-1",
        },
      ],
      {
        sourceAccount: "Assets:Bank",
        defaultCurrency: "USD",
        defaultExpenseAccount: "Expenses:Unknown",
        defaultIncomeAccount: "Income:Unknown",
      },
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.config.externalAccountId).toBeUndefined()
  })

  describe("external account links", () => {
    it("should list links filtered by provider with Bearer auth", async () => {
      const listResponse = {
        items: [
          {
            id: "link-1",
            provider: "plaid",
            externalAccountId: "ext-1",
            beanAccountId: "bean-1",
            isActive: true,
            createdAt: "2026-08-29T00:00:00Z",
            updatedAt: "2026-08-29T00:00:00Z",
          },
        ],
        total: 1,
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => listResponse,
      })

      const result = await client.listExternalAccountLinks("plaid")

      expect(result).toEqual(listResponse)
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/us/bean/external-account-links?provider=plaid",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      )
    })

    it("should create a link with the exact DTO body", async () => {
      const linkResponse = {
        id: "link-2",
        provider: "plaid",
        externalAccountId: "ext-1",
        beanAccountId: "bean-1",
        isActive: true,
        createdAt: "2026-08-29T00:00:00Z",
        updatedAt: "2026-08-29T00:00:00Z",
      }
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => linkResponse,
      })

      const result = await client.createExternalAccountLink({
        provider: "plaid",
        externalAccountId: "ext-1",
        beanAccountId: "bean-1",
      })

      expect(result).toEqual(linkResponse)
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/us/bean/external-account-links",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            provider: "plaid",
            externalAccountId: "ext-1",
            beanAccountId: "bean-1",
          }),
        }),
      )
    })

    it("should reject on a 422 instead of resolving the error body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        text: async () => "beanAccountId not owned",
      })

      await expect(
        client.createExternalAccountLink({
          provider: "plaid",
          externalAccountId: "ext-1",
          beanAccountId: "bean-1",
        }),
      ).rejects.toThrow(/422/)
    })

    it("should delete a link and not parse the 204 body", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: "No Content",
        // no json() — a call would throw and fail the test
      })

      await expect(client.deleteExternalAccountLink("link-1")).resolves.toBeUndefined()

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3000/api/v1/us/bean/external-account-links/link-1",
        expect.objectContaining({ method: "DELETE" }),
      )
    })

    it("should list bean accounts at max page size and unwrap the envelope", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: "a1", path: "Assets:Bank:Checking" }],
          total: 1,
        }),
      })

      const accounts = await client.listBeanAccounts()

      expect(accounts).toEqual([{ id: "a1", path: "Assets:Bank:Checking" }])
      expect(mockFetch.mock.calls[0][0]).toBe(
        "http://localhost:3000/api/v1/us/bean/accounts?limit=500&offset=0",
      )
    })

    it("should paginate bean accounts when the first page is short", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [{ id: "a1", path: "Assets:Bank:Checking" }],
            total: 2,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [{ id: "a2", path: "Assets:Bank:Savings" }],
            total: 2,
          }),
        })

      const accounts = await client.listBeanAccounts()

      expect(accounts).toHaveLength(2)
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch.mock.calls[1][0]).toBe(
        "http://localhost:3000/api/v1/us/bean/accounts?limit=500&offset=500",
      )
    })
  })
})

describe("uploadTransactions", () => {
  it("should create client and upload in one call", async () => {
    const mockResponse = {
      imported: 3,
      skipped: 0,
      pendingReview: 0,
      failed: 0,
    }

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    const result = await uploadTransactions(
      {
        apiUrl: "http://localhost:3000/api/v1",
        apiToken: "test-token",
        region: "us",
      },
      [
        {
          transaction_id: "txn-1",
          amount: 50.0,
          iso_currency_code: "USD",
          date: "2024-01-01",
          name: "Test",
          pending: false,
          account_id: "acc-1",
        },
      ],
      {
        sourceAccount: "Assets:Bank",
        defaultCurrency: "USD",
        defaultExpenseAccount: "Expenses:Unknown",
        defaultIncomeAccount: "Income:Unknown",
      },
    )

    expect(result.imported).toBe(3)
  })
})
