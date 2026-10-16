# @firela/billclaw-ui

## 0.1.0

### Minor Changes

- 01f5205: feat(ui,core): wire relay webhook callback registration into production + webhook-triggered sync (fire-la/firela-bot#33) — RelayClient gains registerWebhookCallback (POST /api/open-banking/health, token-derived routing key, response type aligned with the relay's actual contract {status, registered, account_id}); the UI Worker's scheduled handler re-registers the deployment's observed-origin callback every 6h cron tick (independent waitUntil, openbanking-scope failure guidance); and the /webhook/plaid receiver now fires a debounced (60s) runSyncJob on the signature-verified branch only — closing Plaid → relay → verify → sync end-to-end. ADR-009 amended for the third trigger source.

### Patch Changes

- Updated dependencies [01f5205]
  - @firela/billclaw-core@0.8.0

## 0.0.7

### Patch Changes

- Updated dependencies [afb560b]
  - @firela/billclaw-core@0.7.1

## 0.0.6

### Patch Changes

- Updated dependencies [13c6911]
  - @firela/billclaw-core@0.7.0

## 0.0.5

### Patch Changes

- Updated dependencies [c00601c]
- Updated dependencies [8f7e9f8]
  - @firela/billclaw-core@0.6.0

## 0.0.4

### Patch Changes

- Updated dependencies [756205c]
  - @firela/billclaw-core@0.5.7

## 0.0.3

### Patch Changes

- 6e8d385: Fix silent zero-transfer in the Plaid → VLT sync pipeline (fire-la/firela-bot#37):

  - VLT JWT exchange now hits the region-less auth endpoint — the region-prefixed form 404s on deployed vlt and aborted the sync job before any upload (worker + CLI call sites).
  - `VltClient.sync()` asserts the HTTP status before parsing, so a 4xx error body can no longer be cast to a success result.
  - New `checkUploadResult` helper flags uploads that reported failures or landed nothing; the sync job records `lastUploadResult`/`errorMessage` on the account, invalidates the accounts cache after merging outcomes, and surfaces pre-account aborts (e.g. auth failure) as per-account errors instead of idling silently.

- Updated dependencies [6e8d385]
  - @firela/billclaw-core@0.5.6

## 0.0.2

### Patch Changes

- Updated dependencies
  - @firela/billclaw-core@0.5.5
