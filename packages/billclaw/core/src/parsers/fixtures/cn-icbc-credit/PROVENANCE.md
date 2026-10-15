# Fixture provenance — cn-icbc-credit

- `sample.html`: synthesized for this port (no committed TS fixture existed —
  gate-samples manifest). Covers: foreign txn with originalAmount
  (100.00/USD booked as 672.50/CNY 支出), a (存入) income row, a refund row
  (isRefund + foreign originalAmount), a same-currency row (no
  originalAmount), and an all-empty spacer row (skipped).
- `expected.json`: frozen from a real run of the TS `IcbcCreditParser` over
  `sample.html` (temporary `__freeze__.spec.ts` in vlt, deleted after the run).

## Adaptation record

1. `customFields` flattened into `metadata` (wire policy pin #5).
2. Date repairs — all four rows carried the −1-day local-midnight artifact
   (freeze machine at a non-UTC+8 offset); semantic source dates win:
   `2024-01-15->16`, `2024-01-17->18`, `2024-01-19->20`, `2024-01-21->22`.
3. Amounts unchanged (`-672.5`, `500`, `168.13`, `-88`).

Frozen — never auto-regenerate (`scripts/assert-wasm-fixtures.sh` policy).
