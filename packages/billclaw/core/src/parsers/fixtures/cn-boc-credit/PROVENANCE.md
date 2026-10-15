# Fixture provenance — cn-boc-credit

- `sample.html`: synthesized for this port (no committed TS fixture existed —
  gate-samples manifest). Covers: decoy table without the statement header,
  a numeric entity (&#x67D0;), &nbsp; in amount cells (JS-trim parity), a
  comma-thousands expenditure, a USD deposit row, hyphen narration split,
  and an all-empty spacer row (skipped).
- `expected.json`: frozen from a real run of the TS `BocCreditParser` over
  `sample.html` (temporary `__freeze__.spec.ts` in vlt, deleted after the run).

## Adaptation record

1. `customFields` flattened into `metadata` (wire policy pin #5):
   cardNumber, narration, postingDate.
2. Date repairs — every row carried the −1-day local-midnight artifact (the
   freeze machine runs at a non-UTC+8 offset); semantic source dates win:
   - data[0]: `2024-01-15` -> `2024-01-16`; postingDate
     `2024-01-16T15:00:00.000Z` -> `2024-01-17`
   - data[1]: `2024-01-17` -> `2024-01-18`; postingDate -> `2024-01-19`
   - data[2]: `2024-01-19` -> `2024-01-20`; postingDate -> `2024-01-21`
3. Amounts unchanged (`-1234.5`, `100`, `-56.78`).

Frozen — never auto-regenerate (`scripts/assert-wasm-fixtures.sh` policy).
