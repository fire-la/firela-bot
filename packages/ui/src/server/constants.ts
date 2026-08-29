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
 * App pairing (ADR-009) — storage split (issue #24).
 *
 * Claims live in the D1 `pair_claim` table (code PK, status, origin, created_at,
 * app_id, redeemed_at): a single-use state machine needs the atomic conditional
 * UPDATE KV cannot offer. KV keeps only the long-lived per-request-read records:
 *   PAIR_APP_PREFIX + appId -> { appId, pairedAt, revoked }  (revocation record)
 */
export const PAIR_APP_PREFIX = "firela:pair:app:"

/**
 * Lifetime of an unclaimed pairing claim code (seconds). Enforced as a
 * `created_at` cutoff in the redeem UPDATE and the prune DELETE, and checked
 * in code at the bootstrap claim read; D1 has no TTL-on-entry — this replaces
 * the old KV expirationTtl.
 */
export const PAIR_CLAIM_TTL_SEC = 600

/** Lazy-prune grace beyond the claim TTL before D1 rows are deleted (seconds). */
export const PAIR_CLAIM_PRUNE_GRACE_SEC = 3600

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
 * First-run bootstrap surface (ADR-009 Decision C, issue #21).
 *
 * DONE    — deployment-lifetime flag (NO TTL): set by any successful
 *           POST /api/pair/redeem. Value: { appId, completedAt }. Together with
 *           SETUP_PASSWORD_KEY (owner setup closes the surface too) it gates
 *           GET / in routes/bootstrap.ts.
 * CURRENT — pointer to the still-pending bootstrap claim code, so page refreshes
 *           reuse one code instead of minting many (TTL = PAIR_CLAIM_TTL_SEC).
 */
export const PAIR_BOOTSTRAP_DONE_KEY = "firela:pair:bootstrap_done"
export const PAIR_BOOTSTRAP_CURRENT_KEY = "firela:pair:bootstrap:current"

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
  // Native Flutter client (Phase 40, #19) — connect surface. Bank credentials
  // are minted server-side into KV; the app only submits one-time public
  // tokens. `:id`/`:sessionId` match exactly one non-empty path segment.
  { method: "GET", path: "/api/oauth/plaid/link-token" },
  { method: "POST", path: "/api/oauth/plaid/exchange" },
  { method: "POST", path: "/api/relay/connect/session" },
  { method: "GET", path: "/api/relay/connect/credentials/:sessionId" },
  { method: "PUT", path: "/api/accounts/:id" },
  { method: "DELETE", path: "/api/accounts/:id" },
  { method: "POST", path: "/api/oauth/gocardless/requisitions/:id/status" },
  // Native Flutter client (Phase 40, #19) — config writes. PUT /api/config
  // deep-merges with mask-aware semantics (see routes/config.ts), so the app
  // sends only the keys it edits. Owner-only and deliberately NOT here:
  // /api/cloudflare/* (upgrade, uninstall), PUT /api/settings/cloudflare,
  // PUT /api/settings/relay (the relay API key is owner-configured via the
  // SPA; no app consumer exists), password change, and the config test
  // endpoints (/api/{export,vlt,webhooks}/test — SPA diagnostics; note they
  // mount outside the /api/config prefix) plus webhooks health (no such
  // route; /webhook/health is public HMAC territory).
  { method: "PUT", path: "/api/config" },
  // App-side pairing surface (issue #26 / Track C): the no-SPA CF cohort mints
  // claim codes from the paired app with the owner password as per-request
  // proof — the app never receives an owner credential. establish-owner is the
  // ownerless start (first add-device creates the password and returns the
  // first claim in one response). Handler-level password proof + D1 throttle
  // back the shared paths; the method+path allowlist entry alone mints nothing.
  { method: "POST", path: "/api/pair/issue" },
  { method: "POST", path: "/api/pair/establish-owner" },
] as const
