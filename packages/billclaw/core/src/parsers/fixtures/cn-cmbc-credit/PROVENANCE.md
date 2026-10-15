# Fixture provenance — cn-cmbc-credit

- `sample.csv`: copied verbatim from
  `firela-vlt/main/scripts/generate-parser/gate-samples/cn-cmbc-credit/sample.csv`
  (Phase 73-03 synthesized golden triple).
- `expected.json`: adapted from the gate-sample `ts-expected.json`.

## Adaptation record

1. `customFields` flattened into `metadata` (wire policy pin #5).
2. Date repairs — every tx date carried the −1-day local-midnight artifact
   and every postDate froze as a full ISO timestamp with the same shift
   (the freeze machine runs at a non-UTC+8 offset):
   - data[0]: tx `2024-01-14` -> `2024-01-15`; postDate
     `2024-01-19T15:00:00.000Z` -> `2024-01-20`
   - data[1]: tx `2024-01-09` -> `2024-01-10`; postDate -> `2024-01-15`
   - data[2]: tx `2024-01-04` -> `2024-01-05`; postDate -> `2024-01-10`
   Semantic dates recomputed from the sample rows (MMDD + month-only year
   inference against the post date), per the #19 repair rule.
3. Amounts unchanged (`-156.8`, `-88`, `-500`); the sign reversal and
   `.normalize()` reproduce them.

The foreign-currency narration branch has no fixture row (the gate sample
predates it); it is pinned by unit vectors (`AMAZON US123.45 USD` etc.) in
the crate tests instead.

Frozen — never auto-regenerate (`scripts/assert-wasm-fixtures.sh` policy).
