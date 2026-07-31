/**
 * Auth utilities for browser
 *
 * Manages JWT token storage and provides authenticated fetch wrapper.
 */

const TOKEN_KEY = "firela_auth_token"

/**
 * Get stored JWT token
 */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

/**
 * Store JWT token
 */
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

/**
 * Clear stored JWT token
 */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * Read the role from the stored JWT payload.
 *
 * Client-side decode ONLY — NOT a signature check. The server enforces the real
 * signed role; this is purely to hide owner-only affordances (bank-connect,
 * cloudflare, password) so the dashboard rendered in the firela-app WebView
 * under an `app` token shows no dead-end buttons that would 403 on click.
 */
export function getRole(): "owner" | "app" | null {
  const token = getToken()
  if (!token) return null
  try {
    const payloadB64 = token.split(".")[1]!
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")))
    return (payload?.role as "owner" | "app") ?? null
  } catch {
    return null
  }
}

/**
 * Whether the current token is the owner (full dashboard). The app role hides
 * destructive affordances to avoid dead-ends.
 */
export function isOwnerUser(): boolean {
  return getRole() === "owner"
}

/**
 * Authenticated fetch wrapper
 *
 * Adds Authorization header if token is available.
 * On 401 response, clears token (caller should redirect to setup).
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init?.headers)

  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }

  const response = await fetch(input, {
    ...init,
    headers,
  })

  if (response.status === 401 && token) {
    clearToken()
  }

  return response
}
