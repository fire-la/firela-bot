/**
 * Firela VLT Authentication Manager
 *
 * Provides fully automatic authentication for Firela VLT integration:
 * - Exchanges accessToken for JWT token via /auth/sessions/anonymous
 * - Caches JWT token in system keychain
 * - Auto-refreshes JWT token before expiry (180-day validity)
 *
 * @packageDocumentation
 */

import { KeychainKeys } from "../credentials/keychain.js"
import type { Logger } from "../errors/errors.js"
import type { VltConfig } from "../models/config.js"
import type { CredentialStore } from "../credentials/store.js"

/**
 * JWT token response from VLT /auth/sessions/anonymous endpoint
 */
interface VltAuthResponse {
  authToken: string
}

/**
 * Cached token data stored in keychain
 */
interface CachedToken {
  token: string
  expiresAt: string | null
}

/**
 * Configuration for VltAuthManager
 */
export interface VltAuthManagerConfig {
  /** JWT token expiry in days (default: 180) */
  tokenExpiryDays?: number
  /** Refresh threshold in days before expiry (default: 30) */
  refreshThresholdDays?: number
  /** Background refresh interval in days (default: 7) */
  backgroundRefreshIntervalDays?: number
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<VltAuthManagerConfig> = {
  tokenExpiryDays: 180,
  refreshThresholdDays: 30,
  backgroundRefreshIntervalDays: 7,
}

/**
 * Firela VLT Authentication Manager
 *
 * Manages automatic authentication for Firela VLT integration:
 * 1. Checks keychain for cached JWT token
 * 2. If no valid token, exchanges accessToken for JWT
 * 3. Stores JWT in keychain with expiry time
 * 4. Background refresh to keep token valid
 *
 * @example
 * ```typescript
 * const authManager = new VltAuthManager(vltConfig, credentialStore, logger)
 *
 * // Get valid JWT token (auto-refresh if needed)
 * const jwtToken = await authManager.ensureValidToken()
 *
 * // Start background refresh (optional)
 * authManager.startBackgroundRefresh()
 *
 * // Stop background refresh when done
 * authManager.stopBackgroundRefresh()
 * ```
 */
export class VltAuthManager {
  private refreshInterval: ReturnType<typeof setInterval> | null = null
  private readonly config: Required<VltAuthManagerConfig>

  constructor(
    private readonly vltConfig: VltConfig,
    private readonly credentialStore: CredentialStore,
    private readonly logger?: Logger,
    config?: VltAuthManagerConfig,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Ensure a valid JWT token is available
   *
   * Flow:
   * 1. Check keychain for cached token
   * 2. If valid and not expiring soon, return cached token
   * 3. Otherwise, exchange accessToken for new JWT
   *
   * @returns Valid JWT token
   * @throws Error if accessToken is not configured or exchange fails
   */
  async ensureValidToken(): Promise<string> {
    // 1. Check keychain for cached token
    const cachedToken = await this.getCachedToken()

    // 2. If valid and not expiring soon, return it
    if (cachedToken && !this.isTokenExpiringSoon(cachedToken.expiresAt)) {
      this.logger?.debug?.("Using cached VLT JWT token")
      return cachedToken.token
    }

    // 3. Exchange accessToken for new JWT
    this.logger?.info?.("Obtaining new VLT JWT token...")
    return this.exchangeAccessToken()
  }

  /**
   * Start background token refresh
   *
   * Periodically checks if token needs refresh and refreshes if needed.
   * This ensures the JWT token is always valid even for long-running processes.
   */
  startBackgroundRefresh(): void {
    if (this.refreshInterval) {
      this.logger?.debug?.("Background refresh already running")
      return
    }

    const intervalMs = this.config.backgroundRefreshIntervalDays * 24 * 60 * 60 * 1000

    this.logger?.debug?.(
      `Starting VLT token background refresh (every ${this.config.backgroundRefreshIntervalDays} days)`,
    )

    this.refreshInterval = setInterval(async () => {
      try {
        await this.ensureValidToken()
      } catch (error) {
        this.logger?.error?.("VLT background token refresh failed:", error)
      }
    }, intervalMs)
  }

  /**
   * Stop background token refresh
   *
   * Call this when the auth manager is no longer needed to prevent memory leaks.
   */
  stopBackgroundRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
      this.logger?.debug?.("Stopped VLT token background refresh")
    }
  }

  /**
   * Clear cached JWT token
   *
   * Forces a fresh token exchange on next ensureValidToken() call.
   */
  async clearCachedToken(): Promise<void> {
    await this.credentialStore.delete(KeychainKeys.vltJwtToken())
    await this.credentialStore.delete(KeychainKeys.vltJwtExpiresAt())
    this.logger?.debug?.("Cleared cached VLT JWT token")
  }

  /**
   * Get cached token from keychain
   */
  private async getCachedToken(): Promise<CachedToken | null> {
    const token = await this.credentialStore.get(KeychainKeys.vltJwtToken())
    const expiresAt = await this.credentialStore.get(KeychainKeys.vltJwtExpiresAt())

    if (!token) {
      return null
    }

    return {
      token,
      expiresAt: expiresAt ?? null,
    }
  }

  /**
   * Check if token is expiring soon
   *
   * @param expiresAt - ISO timestamp of token expiry
   * @returns true if token expires within threshold days
   */
  private isTokenExpiringSoon(expiresAt: string | null): boolean {
    if (!expiresAt) {
      return true // No expiry info, treat as expiring
    }

    const expiresDate = new Date(expiresAt)
    const now = new Date()
    const diffDays = (expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)

    return diffDays < this.config.refreshThresholdDays
  }

  /**
   * Exchange accessToken for JWT token
   *
   * Calls VLT /auth/sessions/anonymous endpoint to exchange the long-lived
   * accessToken (from Firela VLT app) for a JWT token.
   *
   * @returns JWT token
   * @throws Error if accessToken is not configured or exchange fails
   */
  private async exchangeAccessToken(): Promise<string> {
    if (!this.vltConfig.accessToken) {
      throw new Error(
        "VLT accessToken not configured. Please add vlt.accessToken to your config. " +
          "You can get an access token from the Firela VLT app.",
      )
    }

    // Auth endpoints are region-less in vlt (auth.controller: 'auth/sessions');
    // a region-prefixed mint 404s (fire-la/firela-bot#37).
    const url = `${this.vltConfig.apiUrl.replace(/\/+$/, "")}/auth/sessions/anonymous`

    this.logger?.debug?.(`Exchanging VLT accessToken for JWT at ${url}`)

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: this.vltConfig.accessToken }),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error")
      throw new Error(
        `VLT authentication failed: ${response.status} ${response.statusText}. ${errorText}`,
      )
    }

    const data = (await response.json()) as VltAuthResponse

    if (!data.authToken) {
      throw new Error("VLT authentication response missing authToken")
    }

    // Calculate expiry time (180 days from now)
    const expiresAt = new Date(
      Date.now() + this.config.tokenExpiryDays * 24 * 60 * 60 * 1000,
    ).toISOString()

    // Store JWT and expiry in keychain
    await this.credentialStore.set(KeychainKeys.vltJwtToken(), data.authToken)
    await this.credentialStore.set(KeychainKeys.vltJwtExpiresAt(), expiresAt)

    this.logger?.info?.(
      `Obtained new VLT JWT token (expires: ${expiresAt})`,
    )

    return data.authToken
  }
}
