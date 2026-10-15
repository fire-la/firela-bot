# Fixture provenance — cn-ccb-debit

- `sample.csv`: copied verbatim from
  `firela-vlt/main/scripts/generate-parser/gate-samples/cn-ccb-debit/sample.csv`
  (identical to the committed `libs/parsers/cn/src/__fixtures__/ccb-debit/`
  pair — the Phase 73-03 golden triple).
- `expected.json`: adapted from the gate-sample `ts-expected.json`.

## Adaptation record

1. `customFields` flattened into `metadata` (wire policy pin #5): cardNumber,
   cashType?, location?, counterpartyName?.
2. Date repairs: NONE — the dashed `YYYY-MM-DD` form parses as UTC midnight
   in JS, so `toISOString()` is timezone-independent and no artifact exists.
3. Amounts unchanged: already decimal.js-trimmed (`-299`, `15000`, `-18.6`);
   the Rust port's `.normalize()` reproduces them.

Frozen — never auto-regenerate (`scripts/assert-wasm-fixtures.sh` policy).
