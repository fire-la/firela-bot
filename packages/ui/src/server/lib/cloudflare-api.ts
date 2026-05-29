/**
 * Cloudflare API helpers for UI server
 *
 * Adapted from CLI cloudflare.ts and uninstall.ts patterns
 * for use in Workers runtime (no process.env, uses c.env instead).
 *
 * @packageDocumentation
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4"
const GITHUB_REPO = "fire-la/firela-bot"

/**
 * Make an authenticated Cloudflare API request
 *
 * @param token - Cloudflare API token
 * @param path - API path (e.g., "/accounts")
 * @param method - HTTP method
 * @param body - Request body (optional)
 * @param contentType - Content-Type header (optional)
 * @returns API response result
 * @throws Error on API failure
 */
export async function cfApiFetch(
  token: string,
  path: string,
  method: string = "GET",
  body?: ArrayBuffer | string,
  contentType?: string,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  }
  if (contentType) {
    headers["Content-Type"] = contentType
  }

  const options: RequestInit = { method, headers }
  if (body !== undefined) {
    options.body = body
  }

  const response = await fetch(`${CF_API_BASE}${path}`, options)

  const responseBody = (await response.json()) as {
    success: boolean
    result: any
    errors?: Array<{ message: string }>
  }

  if (!responseBody.success) {
    const errorMsg =
      responseBody.errors?.map((e) => e.message).join(", ") ??
      `HTTP ${response.status}`
    throw new Error(`Cloudflare API error: ${errorMsg}`)
  }

  return responseBody.result
}

/**
 * Verify Cloudflare API token is valid
 *
 * @param token - Cloudflare API token
 * @returns true if valid, false otherwise
 */
export async function verifyCloudflareAuth(token: string): Promise<boolean> {
  const response = await fetch(`${CF_API_BASE}/user/tokens/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.ok
}

/**
 * Get the first Cloudflare account ID
 *
 * @param token - Cloudflare API token
 * @returns Account ID
 * @throws Error if no accounts found
 */
export async function getAccountId(token: string): Promise<string> {
  const accounts = await cfApiFetch(token, "/accounts")
  if (!accounts || accounts.length === 0) {
    throw new Error("No Cloudflare accounts found")
  }
  return accounts[0].id
}

/**
 * Get latest GitHub Release for the repository
 *
 * @param ghToken - GitHub personal access token
 * @returns Release info with tag name and assets
 * @throws Error if fetch fails
 */
export async function getLatestRelease(ghToken?: string): Promise<{
  tagName: string
  assets: Array<{ id: number; name: string }>
}> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  }
  if (ghToken) {
    headers.Authorization = `Bearer ${ghToken}`
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    { headers },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to fetch latest release: HTTP ${response.status}`,
    )
  }

  const release = (await response.json()) as {
    tag_name: string
    assets: Array<{ id: number; name: string; browser_download_url: string }>
  }

  return {
    tagName: release.tag_name,
    assets: release.assets.map((a) => ({ id: a.id, name: a.name })),
  }
}

/**
 * Download a GitHub Release asset by ID
 *
 * Uses Accept: application/octet-stream to get the raw file content.
 *
 * @param ghToken - GitHub personal access token
 * @param assetId - Release asset ID
 * @returns File content as string
 * @throws Error if download fails
 */
export async function downloadReleaseAsset(
  ghToken: string | undefined,
  assetId: number,
): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/octet-stream",
  }
  if (ghToken) {
    headers.Authorization = `Bearer ${ghToken}`
  }

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${assetId}`,
    { headers, redirect: "follow" },
  )

  if (!response.ok) {
    throw new Error(
      `Failed to download release asset: HTTP ${response.status}`,
    )
  }

  return response.text()
}

/**
 * Enumerate firela-related Cloudflare resources
 *
 * Lists Workers, D1 databases, and KV namespaces, filtering to
 * resources matching "firela" or "billclaw" in name/id/title.
 *
 * @param token - Cloudflare API token
 * @param accountId - Cloudflare account ID
 * @returns Filtered resources grouped by type
 */
export async function enumerateResources(
  token: string,
  accountId: string,
): Promise<{
  workers: Array<{ id: string; title?: string }>
  databases: Array<{ id: string; name: string }>
  kvNamespaces: Array<{ id: string; title: string }>
}> {
  const [workers, databases, kvNamespaces] = await Promise.all([
    cfApiFetch(token, `/accounts/${accountId}/workers/scripts`),
    cfApiFetch(token, `/accounts/${accountId}/d1/database`),
    cfApiFetch(token, `/accounts/${accountId}/storage/kv/namespaces`),
  ])

  const isFirelaResource = (name: string) =>
    name.toLowerCase().includes("firela") ||
    name.toLowerCase().includes("billclaw")

  return {
    workers: (workers ?? []).filter(
      (w: any) => isFirelaResource(w.id ?? "") || isFirelaResource(w.title ?? ""),
    ),
    databases: (databases ?? []).filter(
      (d: any) => isFirelaResource(d.name ?? ""),
    ),
    kvNamespaces: (kvNamespaces ?? []).filter(
      (k: any) => isFirelaResource(k.title ?? ""),
    ),
  }
}

/**
 * Delete specified Cloudflare resources
 *
 * Deletes each resource individually. Failed deletions do NOT abort
 * remaining deletions — all are attempted.
 *
 * @param token - Cloudflare API token
 * @param accountId - Cloudflare account ID
 * @param resources - Resource IDs to delete, grouped by type
 * @returns Per-resource deletion results
 */
export async function deleteResources(
  token: string,
  accountId: string,
  resources: {
    workers?: string[]
    databases?: string[]
    kvNamespaces?: string[]
  },
): Promise<
  Array<{ resource: string; type: string; success: boolean; error?: string }>
> {
  const results: Array<{
    resource: string
    type: string
    success: boolean
    error?: string
  }> = []

  const deletions: Array<{ id: string; type: string; path: string }> = [
    ...(resources.workers ?? []).map((id) => ({
      id,
      type: "Worker",
      path: `/accounts/${accountId}/workers/scripts/${id}`,
    })),
    ...(resources.databases ?? []).map((id) => ({
      id,
      type: "D1 Database",
      path: `/accounts/${accountId}/d1/database/${id}`,
    })),
    ...(resources.kvNamespaces ?? []).map((id) => ({
      id,
      type: "KV Namespace",
      path: `/accounts/${accountId}/storage/kv/namespaces/${id}`,
    })),
  ]

  for (const item of deletions) {
    try {
      await cfApiFetch(token, item.path, "DELETE")
      results.push({ resource: item.id, type: item.type, success: true })
    } catch (err) {
      results.push({
        resource: item.id,
        type: item.type,
        success: false,
        error: (err as Error).message,
      })
    }
  }

  return results
}
