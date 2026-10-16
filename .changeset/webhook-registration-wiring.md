---
"@firela/billclaw-core": minor
"@firela/billclaw-ui": minor
---

feat(ui,core): wire relay webhook callback registration into production + webhook-triggered sync (fire-la/firela-bot#33) — RelayClient gains registerWebhookCallback (POST /api/open-banking/health, token-derived routing key, response type aligned with the relay's actual contract {status, registered, account_id}); the UI Worker's scheduled handler re-registers the deployment's observed-origin callback every 6h cron tick (independent waitUntil, openbanking-scope failure guidance); and the /webhook/plaid receiver now fires a debounced (60s) runSyncJob on the signature-verified branch only — closing Plaid → relay → verify → sync end-to-end. ADR-009 amended for the third trigger source.
