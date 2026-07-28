## Q15 material config closure

Status: DONE

Scope closed
- Generalized governed config CRUD across financially material config resources in `backend/src/routes/config.ts` via `createCrudRouter(...)`.
- Fixed governed CRUD request lifecycle so governance requests run inside the caller's idempotent transaction instead of opening a nested transaction.
- Added focused backend regression coverage for governed create/update/delete, replay, stale approval, role separation, return-for-evidence/reject, and customer material-field governance.
- Added truthful frontend pending-request feedback in the shared config CRUD hook so governed create/update/delete no longer look like an immediately applied save.

Resource coverage
- `pricing_tables`
- `road_allowances`
- `fuel_norms`
- `weight_pricing_tiers`
- `lift_pricing`
- `ancillary_revenue`
- `management_fees`
- `cap_table_history`
- `truck_cap_table`
- `customers` material debt-authority fields only: `creditLimit`, `creditWarningThreshold`, `paymentTermDays`, `paymentDatePolicy`, `debitNoteMode`, `debitNoteTemplateId`, `linkedSupplierId`

Files changed
- `backend/src/services/price-config-governance.service.ts`
- `backend/src/routes/utils/crud-factory.ts`
- `backend/src/routes/config.ts`
- `backend/src/tests/q15-price-config-governance.test.ts`
- `frontend/src/hooks/useCRUD.ts`
- `frontend/src/hooks/useCRUD.test.tsx`

Root cause fixed
- rerun7 hang came from nested transactions: `runIdempotent(...)` already provided `tx`, but governed CRUD helpers opened `db.transaction(...)` again. The CRUD factory now passes `transaction: tx`, and the governance helpers reuse it.

QA evidence
- Focused backend test green: `qa/2026-07-28_q15-price-config-governance_backend-test.rerun10.log`
- Backend typecheck green: `qa/2026-07-28_q15-price-config-governance_backend-typecheck.rerun2.log`
- Frontend regression test green: `qa/2026-07-28_q15-material-config-frontend-test.log`
- Frontend typecheck green: `qa/2026-07-28_q15-material-config-frontend-typecheck.log`

Notes
- The replay-test approval 409 was fixture drift, not a product defect: `pricingTableSchema` does not accept `effectiveDate`, so replay isolation had to use a fresh route key instead of an ignored date field.
- Frontend truthful pending behavior is centralized in `useCRUD`, so all config pages still using `<CrudTable>` inherit the same governed-response message without per-page patches.
