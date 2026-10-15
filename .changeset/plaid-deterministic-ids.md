---
"@firela/billclaw-core": patch
---

fix(parsers): deterministic transaction ids for the plaid leg (fire-la/firela-bot#51) — EU/HK uploads stop defaulting to randomUUID per row: transaction_id is now the crate serial when present (degiro orderId/reference, IB ibOrderId) and otherwise the `date|amount|currency|description#occurrence` composite, mirroring the #45 parsed-bill leg so server-side dedup holds on re-import. Migration note: files imported before this change hold random ids and will not dedup against the new deterministic ids (same class of transition as #45).
