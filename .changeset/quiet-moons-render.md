---
"@firela/billclaw-core": patch
"@firela/billclaw-cli": patch
---

fix(parsers): render parser dates from local components on the legacy plaid transport (fire-la/firela-bot#46) - transformParsedTransactions used toISOString() (UTC) while every pinned parser constructs dates with the bill's Y/M/D as local components, so imported rows landed one day early on runtimes east of UTC (e.g. UTC+8, where CN/HK bills originate). Both transports now share the #45 toBillDateString helper (local-component round-trip, timezone-stable), and the CLI dry-run raw-sample display uses it too; tests construct Date mocks via local components so they hold in any timezone.
