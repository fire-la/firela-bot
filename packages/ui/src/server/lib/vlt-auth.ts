/**
 * Worker-side VLT JWT exchange + KV cache.
 *
 * Replaces the CLI's `VltAuthManager`, which caches the JWT in the OS keychain
 * (unavailable in Cloudflare Workers). Exchanges the long-lived VLT accessToken
 * for a short-lived JWT via the anonymous-session endpoint and caches it in the
 * CONFIG KV namespace.
 *
 * @packageDocumentation
 */

import type { VltRegion } from "@firela/billclaw-core"

/** KV key for the cached VLT JWT ({ authToken, expiresAt }). */
export const VLT_JWT_KV_KEY = "firela:vlt:jwt"

/** Stored expiry (days) — safe margin under the server-side 180-day validity. */
const VLT_JWT_TTL_DAYS = 150

/** Refresh this many days before expiry to avoid edge races. */
const VLT_JWT_REFRESH_BUFFER_DAYS = 7

interface CachedJwt {
  authToken: string
  expiresAt: string // ISO timestamp
}

export interface VltAuthConfig {
  apiUrl: string
  accessToken: string
  region: VltRegion
}

/**
 * Get a VLT JWT, exchanging via /auth/sessions/anonymous when the cached token is
 * absent or expiring soon. Cached in CONFIG KV at {@link VLT_JWT_KV_KEY}.
 *
 * @throws Error if the exchange request fails or the response lacks `authToken`.
 */
export async function getVltJwt(
  env: { CONFIG: KVNamespace },
  vlt: VltAuthConfig,
): Promise<string> {
  const cached = await env.CONFIG.get<CachedJwt>(VLT_JWT_KV_KEY, "json")
  if (cached?.authToken && cached.expiresAt) {
    const bufferMs = VLT_JWT_REFRESH_BUFFER_DAYS * 24 * 60 * 60 * 1000
    if (new Date(cached.expiresAt).getTime() - bufferMs > Date.now()) {
      return cached.authToken
    }
  }

  const url = `${vlt.apiUrl}/${vlt.region}/auth/sessions/anonymous`
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken: vlt.accessToken }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(
      `VLT auth exchange failed (${response.status}): ${body || response.statusText}`,
    )
  }

  const data = (await response.json()) as { authToken?: string }
  if (!data.authToken) {
    throw new Error("VLT auth exchange response missing authToken")
  }

  const cachedJwt: CachedJwt = {
    authToken: data.authToken,
    expiresAt: new Date(
      Date.now() + VLT_JWT_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  }
  await env.CONFIG.put(VLT_JWT_KV_KEY, JSON.stringify(cachedJwt))

  return data.authToken
}
