/**
 * Shared Plaid item due-filter (Rule 0 — single source).
 *
 * Both the scheduled sync job (jobs/sync-job.ts) and the account-links
 * discovery route (routes/account-links.ts) must agree on which connected
 * Plaid items are "live": if the two filters drift, discovery offers accounts
 * sync never feeds (dead ExternalAccountLinks) or hides mappable ones.
 *
 * @packageDocumentation
 */

/** Stored `billclaw:accounts` record fields relevant to Plaid eligibility. */
export interface PlaidItem {
  id: string
  name?: string
  provider?: string
  type?: string
  plaidAccessToken?: string
  enabled?: boolean
  status?: string
}

/** True when the item is a connected, enabled Plaid item with a stored token. */
export function isPlaidItemDue(a: PlaidItem): boolean {
  return (
    (a.provider === "plaid" || a.type === "plaid") &&
    !!a.plaidAccessToken &&
    a.enabled !== false &&
    a.status === "connected"
  )
}
