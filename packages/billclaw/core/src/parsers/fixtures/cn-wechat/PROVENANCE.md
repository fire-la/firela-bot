# Fixture provenance — cn-wechat

- `sample.csv`: synthesized for this port (no committed TS fixture existed —
  confirmed by the Phase 73-03 gate-samples manifest). Covers every skip
  branch: neutral `/` flow row, `已关闭` status row, plus an empty-counterparty /
  empty-merchantOrderId row and a ¥-prefixed amount.
- `expected.json`: frozen from a real run of the TS `WechatParser` over
  `sample.csv` (temporary `__freeze__.spec.ts` in vlt `libs/parsers/cn`,
  deleted after the run; jest resolves the `@firela/parser-core` alias).

## Adaptation record

1. `customFields` flattened into `metadata` (wire policy pin #5): status,
   transactionType?, orderNo? merged alongside paymentMethod?/merchantOrderId?.
2. `warnings` dropped (the TS run emitted two SKIPPED_ROW warnings — the wire
   policy for these ports carries no warnings key).
3. Date repair: data[3] `2024-01-19` -> `2024-01-20` (source row
   `2024-01-20 08:05:00`; the freeze harness's `toISOString()` shifted it back
   one day on this machine's timezone). data[0..2] matched their source rows.
4. Amounts unchanged: already decimal.js-trimmed (`-68.5`, `500`); the Rust
   port's `.normalize()` reproduces them.

## Known shared quirk (documented, not fixed)

An unquoted amount containing an ASCII comma (`¥1,234.56`) splits the CSV row
in BOTH the TS (csv-parse) and Rust (csv crate) readers identically — the
thousands separator must not appear unquoted. The fixture uses `¥1234.56`.

Frozen — never auto-regenerate (`scripts/assert-wasm-fixtures.sh` policy).
