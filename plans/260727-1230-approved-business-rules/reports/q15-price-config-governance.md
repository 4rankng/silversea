# Q15 price-config governance — pricing-tables slice

Date: 2026-07-27
Status: partial

Implemented

- `PRICE_CONFIG_CHANGE` policy registered for `PRICE_CONFIG` subjects.
- `/api/pricing-tables` create, update, and delete now create governance actions instead of mutating the table directly.
- generic `/api/governance-actions/:id/check` and `/approve` now apply approved pricing-table actions transactionally.
- approval apply records the created `subjectId` for governed creates and soft-deletes rows for governed deletes.
- focused backend route test covers direct no-effect, 3 distinct actors, create/update/delete apply, and stale source conflict.
- compile regression in `price-config-governance.service.ts` fixed by replacing loose replay payload casts with validated typed create/update payload parsing before Drizzle insert/update apply.

Not yet implemented in this slice

- the rest of the material config resources from Q15 surface 17-18
- customer payment-term field allowlist
- road/fuel/salary-period singleton governance

QA artifacts

- `qa/2026-07-27_q15-pricing-table-governance_backend-test.log`
- `qa/2026-07-27_q15-pricing-table-governance_backend-typecheck.log`
- `qa/2026-07-27_q15-pricing-table-governance_lint.log`
- `qa/2026-07-27_q15-price-config-governance_backend-test.rerun2.log`
- `qa/2026-07-27_q15-price-config-governance_backend-typecheck.rerun.log`
- `qa/2026-07-27_q15-price-config-governance_build-chain.rerun.log`
- `qa/2026-07-27_q15-price-config-governance_backend-test.rerun.log` (wrong harness; repo ESM setup rejects direct `node --test`)
