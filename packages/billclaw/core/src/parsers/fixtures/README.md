# Parser fixtures (vendored from firela-sdk)

Golden fixtures for the @firela/* wasm parser crates, vendored verbatim from
`firela-sdk/<crate>/tests/fixtures/` at crate version **0.1.11**
(fire-la/firela-bot#44). Each crate directory carries its sample input file(s)
plus the crate's frozen golden output (`expected.json`; eu-deutsche-bank has
dual-locale goldens `expected-de.json` / `expected-en.json`) and the upstream
`PROVENANCE.md` where one exists.

Upstream marks these fixtures **frozen — never auto-regenerate**. The same
applies here:

- **Do not edit** any file in this directory by hand.
- **Resync procedure**: when bumping the pinned crate versions, copy the new
  `sample.*` / `expected*.json` / `PROVENANCE.md` files verbatim from the
  firela-sdk checkout at the matching tag, and update the version in this
  README. A golden change that is not a version bump is a bug — investigate
  before committing.

Note: `cn-alipay` / `cn-alipay-yuebao` carry GBK-encoded variants
(`sample-gbk.csv`) alongside the UTF-8 samples.
