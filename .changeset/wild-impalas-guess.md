---
"@firela/billclaw-core": patch
---

fix(cli): surface swallowed zero-transfers in the CLI upload path (fire-la/firela-bot#38) - the success branch now runs the shared `checkUploadResult` predicate and records a failed status with the problem as `errorMessage` when VLT reports failures or lands nothing, matching the Worker sync job's semantics.
