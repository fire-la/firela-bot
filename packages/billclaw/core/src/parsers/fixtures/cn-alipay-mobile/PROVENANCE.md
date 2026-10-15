# Fixture provenance — cn-alipay-mobile

- `sample.csv`: authored for this crate (agent-loop-generated parser, no TS
  gate-sample source of truth — see the crate header); UTF-8 Alipay App
  export shape with banner block, header row, and 3 data rows spanning
  花呗 / 余额宝 / 余额 funding methods.
- `expected.json`: authored alongside the sample; hand-maintained.

## Adaptation record

1. Metadata key rename (fire-zu/firela-sdk#27, ADR-0130 v2 decision 7):
   `method` -> `paymentMethod` — cross-crate convergence on the canonical
   funding-source key consumed by the parsed-bill wire field
   `fundingSource` (vlt#1922). Key position moved to its BTreeMap-sorted
   slot (after `payeeAccount`; before `remark`/`status`).

Frozen — never auto-regenerate (`scripts/assert-wasm-fixtures.sh` policy).
