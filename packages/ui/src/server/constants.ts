/**
 * Server Constants
 *
 * Default values for environment bindings.
 * Used as fallbacks when env vars are not set in Cloudflare Workers.
 *
 * @packageDocumentation
 */

/** Default Relay service URL (production) */
export const DEFAULT_RELAY_URL = "https://relay.firela.io"

/** Default Plaid environment */
export const DEFAULT_PLAID_ENV = "sandbox"

/** KV key for auto-generated JWT signing secret */
export const AUTH_SECRET_KEY = "firela:auth:jwt_secret"

/** KV key for setup password (set on first /auth/setup call) */
export const SETUP_PASSWORD_KEY = "firela:auth:setup_password"

/** KV key for relay API key (configured via UI settings) */
export const RELAY_API_KEY_KEY = "firela:relay:api_key"

/** KV key for Cloudflare API token (configured via UI settings) */
export const CF_API_TOKEN_KEY = "firela:cloudflare:api_token"

/**
 * App pairing (ADR-009) — KV key prefixes and TTLs.
 *
 * PAIR_CLAIM_PREFIX + claimCode -> { status, createdAt, appId? }  (short-lived claim)
 * PAIR_APP_PREFIX   + appId     -> { appId, pairedAt, revoked }   (revocation record)
 */
export const PAIR_CLAIM_PREFIX = "firela:pair:claim:"
export const PAIR_APP_PREFIX = "firela:pair:app:"

/** Lifetime of an unclaimed pairing claim code (seconds). */
export const PAIR_CLAIM_TTL_SEC = 600

/** Lifetime of a signed app pairing token — 1 year (matches the owner token). */
export const PAIR_TOKEN_TTL_SEC = 365 * 24 * 60 * 60

/**
 * D2 "TTL-on-entry ≈ max token age" for the revocation list. Bound to the TOKEN
 * TTL, NOT 39-PLAN's literal "90d": a record TTL shorter than the 1y token would
 * make authMiddleware read a pruned record as null -> 401 APP_NOT_PAIRED on a
 * still-valid token — the exact "silent logout" D2 forbids. The record self-prunes
 * as the token itself expires. (Resolves an internal inconsistency in 39-PLAN D2.)
 */
export const PAIR_APP_TTL_SEC = PAIR_TOKEN_TTL_SEC

/**
 * Method+path tuples an `app`-role JWT may reach (exact match). Method-aware
 * because path-based allowlisting is unsafe: `GET /api/config` (masked read)
 * shares a path with `PUT /api/config` (owner write), and
 * `POST /api/oauth/plaid/exchange` mints a bank credential into KV — a bare
 * path allowlist would grant the destructive sibling of every read. Everything
 * else under /api/* is denied to app tokens (APP_ROLE_PATH_DENIED). Owner tokens
 * are unaffected. See isAppAllowed in middleware/auth.ts + ADR-009 D4 (amended:
 * path -> method+path).
 */
export const APP_ROLE_ALLOWLIST = [
  { method: "POST", path: "/api/sync/run" },
  { method: "GET", path: "/api/sync/status" },
  { method: "GET", path: "/api/accounts" },
  { method: "GET", path: "/api/config" },
  { method: "GET", path: "/api/system/status" },
  { method: "GET", path: "/api/services" },
  { method: "GET", path: "/api/settings/relay" },
  { method: "GET", path: "/api/settings/cloudflare" },
  { method: "GET", path: "/api/cloudflare/version" },
  { method: "GET", path: "/api/cache/stats" },
] as const
