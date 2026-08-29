/**
 * Bank-mapping helpers for the Bank Mapping page (issue #18 Tier 0).
 *
 * Typed apiFetch wrappers over /api/account-links/*: discover external Plaid
 * accounts, list vlt BeanAccounts, and manage the opaque external-account →
 * BeanAccount links stored in vlt.
 */

import type { ExternalAccountLinkResponseDto } from "@firela/api-types"

import { apiFetch } from "@/lib/auth"
// Type-only import from the server route (erased at build) — the discovery
// payload shape has a single source instead of a drifting client copy.
import type {
  DiscoveredAccount,
  ItemDiscoveryError,
} from "@/server/routes/account-links"

export type { DiscoveredAccount, ItemDiscoveryError }

/** vlt link row (authoritative type from @firela/api-types). */
export type LinkView = ExternalAccountLinkResponseDto

/** A vlt BeanAccount (mapping target). */
export interface BeanAccountView {
  id: string
  path: string
  type?: string
  status?: string
  openDate?: string
}

/** Thrown when VLT is not configured (400 VLT_NOT_CONFIGURED). */
export class VltNotConfiguredError extends Error {
  constructor(message = "Firela VLT is not configured") {
    super(message)
    this.name = "VltNotConfiguredError"
  }
}

/**
 * Fetch an /api/account-links endpoint and unwrap the {success, data} envelope.
 *
 * @throws VltNotConfiguredError on 400 VLT_NOT_CONFIGURED
 * @throws Error with the server-provided message otherwise
 */
async function callApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init)
  const json = (await res.json().catch(() => null)) as
    | { success: boolean; data?: T; error?: string; errorCode?: string }
    | null
  if (!res.ok || !json?.success) {
    if (json?.errorCode === "VLT_NOT_CONFIGURED") {
      throw new VltNotConfiguredError(json.error)
    }
    throw new Error(json?.error || `Request failed (${res.status})`)
  }
  return json.data as T
}

export function listDiscoveredAccounts(): Promise<{
  accounts: DiscoveredAccount[]
  errors: ItemDiscoveryError[]
}> {
  return callApi("/api/account-links/discover")
}

export async function listBeanAccounts(): Promise<BeanAccountView[]> {
  const data = await callApi<{ accounts: BeanAccountView[] }>(
    "/api/account-links/bean-accounts",
  )
  return data.accounts ?? []
}

export async function listLinks(): Promise<LinkView[]> {
  const data = await callApi<{ items: LinkView[]; total: number }>(
    "/api/account-links",
  )
  return data.items ?? []
}

export function createLink(
  externalAccountId: string,
  beanAccountId: string,
): Promise<LinkView> {
  return callApi<LinkView>("/api/account-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ externalAccountId, beanAccountId }),
  })
}

export async function deleteLink(id: string): Promise<void> {
  await callApi<unknown>(`/api/account-links/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

/**
 * Remap an external account to a different BeanAccount. vlt semantics:
 * DELETE the active link, then POST the new one (no replacedById chain).
 */
export async function remapLink(
  id: string,
  externalAccountId: string,
  beanAccountId: string,
): Promise<LinkView> {
  await deleteLink(id)
  return createLink(externalAccountId, beanAccountId)
}
