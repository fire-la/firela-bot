---
"@firela/billclaw-core": patch
---

Release pipeline: version and dependency-bump PRs are now created under the release app identity so their CI/E2E runs no longer sit in `action_required` awaiting manual approval (fixes the recurring release-blocker workflow)
