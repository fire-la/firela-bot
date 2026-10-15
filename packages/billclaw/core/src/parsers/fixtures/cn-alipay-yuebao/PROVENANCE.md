# Fixture provenance — cn-alipay-yuebao

- `sample.csv`: copied verbatim from
  `firela-vlt/main/scripts/generate-parser/gate-samples/cn-alipay-yuebao/sample.csv`
  (Phase 73-03 synthesized golden triple; TS source of truth).
- `sample-gbk.csv`: GBK transcoding of `sample.csv` (generated once via
  `python3 -c "open('sample-gbk.csv','wb').write(open('sample.csv',encoding='utf-8').read().encode('gbk'))"`);
  shares `expected.json` — the GBK path must produce identical output.
- `expected.json`: adapted from the gate-sample `ts-expected.json`.

## Adaptation record

1. `customFields` flattened into `metadata` (wire policy pin #5 of the #19
   kickoff): `status`/`category` merged alongside `account`.
2. Date repairs — the TS freeze harness emits `toISOString().split('T')[0]`;
   local-midnight times in UTC+8 shift back one day. Semantic source dates
   win (wire policy pin #5):
   - data[0]: `2025-09-23` -> `2025-09-24` (source row `2025-09-24 03:39:33`)
   - data[1]: `2025-09-22` -> `2025-09-23` (source row `2025-09-23 03:10:39`)
   - data[2], data[3]: no artifact (times 19:38 / 20:10 are past 08:00 UTC).
3. Amounts unchanged: already decimal.js-trimmed (`-3.9`); the Rust port's
   `.normalize()` reproduces them (`-3.90` -> `-3.9`).
4. Funding-source key (fire-zu/firela-sdk#27, ADR-0130 v2 decision 7): the
   `account` metadata key (TS-parity flattening of the 账户 column) is
   replaced by the canonical `paymentMethod` — the 账户 column (col 5)
   carries the funding token (余额宝 / 余额宝|中国工商银行), while the 来源
   column (col 6) is the constant 账单同步 and carries no funding data
   (5-row fixture evidence; ADR-0130 v2's "补读来源列" wording corrected by
   dated errata on the vlt side). Key dropped, not twinned: zero ecosystem
   consumers of `metadata.account`; TS source retired with ADR-0135.

Frozen — never auto-regenerate (`scripts/assert-wasm-fixtures.sh` policy).
