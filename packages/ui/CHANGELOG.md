# @firela/billclaw-ui

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
