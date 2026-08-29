/**
 * Pairing helpers for the dashboard Pair page.
 *
 * The pairing URL format is a cross-repo contract: the firela mobile app's
 * QR scanner / "paste pairing link" parser reads the same string. The claim
 * code lives in the URL *fragment* so it is never sent to the server on
 * fetch (Worker logs and link-preview bots stay code-free).
 */

import { apiFetch } from "@/lib/auth"

/** Response body of `POST /api/pair/issue` (owner Bearer). expiresAt is unix seconds. */
export interface PairIssueResponse {
  success: boolean
  claimCode: string
  workerUrl: string
  expiresAt: number
}

/** A paired-device record from `GET /api/pair/apps`. pairedAt is unix seconds. */
export interface PairedApp {
  appId: string
  pairedAt: number
  revoked: boolean
}

/**
 * Build the plain pairing URL: `{workerUrl}/pair#code={claimCode}`.
 * The raw (un-hyphenated) 8-char code is embedded — `7Q3K-D9XR` grouping
 * is display-only.
 */
export function buildPairingUrl(workerUrl: string, claimCode: string): string {
  const origin = workerUrl.replace(/\/+$/, "")
  return `${origin}/pair#code=${claimCode}`
}

/** Group an 8-char claim code for display: `7Q3KD9XR` -> `7Q3K-D9XR`. */
export function groupClaimCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

/** Format a remaining-time in ms as `mm:ss`, clamping negatives to zero. */
export function formatCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000))
  const mm = Math.floor(totalSec / 60)
  const ss = totalSec % 60
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

/**
 * Copy text via the async clipboard API. Returns false on failure so the
 * caller can toast an error while keeping the text selectable. No
 * execCommand fallback — every real serving mode is a secure context
 * (Workers https; wrangler dev on localhost too).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** GET /api/pair/apps (owner Bearer attached by apiFetch). */
export async function listPairedApps(): Promise<{
  success: boolean
  apps?: PairedApp[]
  error?: string
}> {
  const res = await apiFetch("/api/pair/apps")
  // res.ok guard: a platform-level 5xx can carry a non-JSON body (HTML error
  // page), where res.json() would throw and read as a network error instead.
  if (!res.ok) return { success: false, error: `Request failed (${res.status})` }
  return res.json()
}

/** POST /api/pair/revoke (owner Bearer). */
export async function revokeApp(appId: string): Promise<{
  success: boolean
  error?: string
}> {
  const res = await apiFetch("/api/pair/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId }),
  })
  if (!res.ok) return { success: false, error: `Request failed (${res.status})` }
  return res.json()
}
