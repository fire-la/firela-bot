/**
 * Deployment Origin Capture
 *
 * Scheduled handlers have no request to read the deployment's public URL
 * from, and no env var carries it. This middleware captures the observed
 * origin (scheme+host) of the first request per isolate into KV, where the
 * webhook-registration job picks it up. The origin derivation is the same
 * one routes/pair.ts already trusts for user-facing connect URLs; CF routes
 * by hostname, so every captured origin is a host that genuinely reaches
 * this worker.
 *
 * @packageDocumentation
 */

import type { MiddlewareHandler } from "hono"

import { DEPLOYMENT_ORIGIN_KEY } from "../constants.js"
import type { Env } from "../index.js"

/** Once-per-isolate gate — cold-start herds all writing the same key would
 * trip KV's 1-write-per-key-per-second limit, and re-reading per request
 * would waste a KV read. Armed only after a successful attempt, so a
 * transient KV failure retries on the next request. */
let originCapturedThisIsolate = false

/**
 * Capture the deployment's public origin into KV (once per isolate).
 *
 * Write rule: only when KV is empty or holds a *.workers.dev origin — an
 * established custom origin is never displaced by another host.
 * // ponytail: two-custom-domain deployments keep whichever was first; add an
 * explicit owner-set URL setting if that ever matters.
 *
 * Never fails a request: all KV errors are swallowed (capture is best-effort).
 */
export function captureDeploymentOrigin(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (!originCapturedThisIsolate) {
      try {
        const origin = new URL(c.req.url).origin
        const stored = await c.env.CONFIG.get(DEPLOYMENT_ORIGIN_KEY)
        // null, malformed, or *.workers.dev stored values are all
        // replaceable; an established custom origin is never displaced.
        let storedIsReplaceable = stored === null
        if (stored !== null) {
          try {
            storedIsReplaceable = new URL(stored).hostname.endsWith(
              ".workers.dev",
            )
          } catch {
            storedIsReplaceable = true // malformed — replace it
          }
        }
        if (storedIsReplaceable && stored !== origin) {
          await c.env.CONFIG.put(DEPLOYMENT_ORIGIN_KEY, origin)
        }
        // Arm the once-per-isolate gate only on success — a transient KV
        // failure retries on the next request in this same isolate.
        originCapturedThisIsolate = true
      } catch (error) {
        // KV unavailable — never fail the request; retried next request.
        // Logged so a persistently broken capture (and its downstream
        // no-registration symptom) is diagnosable from `wrangler tail`.
        console.warn("[deployment-origin] capture failed:", error)
      }
    }
    await next()
  }
}
