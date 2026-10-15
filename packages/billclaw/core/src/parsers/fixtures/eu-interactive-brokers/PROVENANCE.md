# Fixture provenance — eu-interactive-brokers

- `sample.csv`: copied verbatim from
  `firela-vlt/main/scripts/generate-parser/gate-samples/eu-interactive-brokers/sample.csv`
  (Phase 73-03 golden triple: a Trades section and a Cash Transactions
  section, each with the literal `Header` row and a full column header).
- `expected.json`: adapted from the gate-sample `ts-expected.json`.

## Adaptation record

1. `customFields` (all keys, including empty strings like tradeId:"") merged
   with the truthy-only TS `metadata` ({quantity, tradePrice, fees, tradeId})
   and flattened into one `metadata` map (#19 pin). Values identical where
   both carried them.
2. Date repairs — the two Cash rows (bare `YYYYMMDD` = local-midnight Date)
   carried the −1-day artifact: `2024-02-19 -> 2024-02-20`,
   `2024-02-20 -> 2024-02-21`. The Trades rows (`YYYYMMDD;HHMMSS` at
   09:30/10:15) matched their source dates.
3. Amounts unchanged (`18549`, `-18913`, `500`, `-25` — proceeds + comm/fee,
   decimal.js trim). Numeric metadata kept as JSON numbers with the JS rule
   (integral floats as integers: `18550`, `-0.5`, `378.25`).

Frozen — never auto-regenerate (`scripts/assert-wasm-fixtures.sh` policy).
