## Phase Implementation Report

### Executed Phase
- Phase: phase-04-ap-fuel-suppliers-and-offsets
- Plan: `plans/260727-1230-approved-business-rules`
- Status: done_with_concerns

### Files Modified
- `backend/src/db/schema.ts`
- `backend/src/routes/config.ts`
- `backend/src/services/config.service.ts`
- `backend/src/services/debtOffset.service.ts`
- `backend/src/services/fuel-ap-recon.service.ts`
- `backend/src/services/fuel-invoice.service.ts`
- `backend/src/services/legal-partner.service.ts`
- `backend/src/services/supplier-types.service.ts`
- `backend/src/tests/m57-receivable-reminder.test.ts`
- `backend/src/tests/m61-fuel-ap-recon.test.ts`
- `backend/src/tests/m62-supplier-types.test.ts`
- `backend/src/tests/m64-debt-offsets.test.ts`
- `frontend/src/pages/SupplierListPage.tsx`
- `shared/src/schemas/index.ts`
- `shared/src/types/index.ts`

### Tasks Completed
- [x] Added additive schema for canonical legal partners, fuel invoice headers, fuel invoice allocations, supplier `primaryType`, and stricter debt-offset metadata.
- [x] Added supplier/customer partner syncing by normalized tax code.
- [x] Added supplier-type normalization with reporting-only `primaryType`.
- [x] Switched fuel AP reconciliation to count approved fuel-invoice allocations and avoid double-counting linked legacy trip expenses.
- [x] Added fuel-invoice approval service with maker-checker, allocation completeness, and liters/amount reconciliation checks.
- [x] Tightened debt-offset creation/approval to require same canonical partner, VND currency, minutes reference, and bounded manual offset amount.
- [x] Updated supplier UI to edit multi-type classification plus reporting primary type.
- [x] Extended `m61`, `m62`, and `m64` tests for the new business rules.
- [x] Patched schema-driven reminder-test fixture fallout from mandatory debt-offset partner/minutes fields.
- [x] Repaired local migration bookkeeping by recording already-applied `0139_q15_governance_foundation`, then applied `0140_credit_fuel_no_invoice_controls` through `drizzle-kit migrate`.
- [x] Re-ran `m61`, `m62`, and `m64` sequentially against the migrated local DB and confirmed all pass.

### Tests Status
- Database migration: pass
  - `qa/2026-07-27_q06-q08-ap-fuel-offsets_db-migration-repair.log`
  - `qa/2026-07-27_q06-q08-ap-fuel-offsets_db-migrate.log`
  - `qa/2026-07-27_q06-q08-ap-fuel-offsets_db-migrate-pnpm.log`
- Backend type check: pass
  - `qa/2026-07-27_q06-q08-ap-fuel-offsets_backend-typecheck.log`
- Frontend type check: fail
  - `qa/2026-07-27_q06-q08-ap-fuel-offsets_frontend-typecheck.log`
  - Remaining frontend red is outside Q06-Q08: `AppSettingsConfigPage.tsx` still initializes the older 3-field settings shape.
- Focused backend tests: pass
  - `qa/2026-07-27_q06-q08-ap-fuel-offsets_m61.log`
  - `qa/2026-07-27_q06-q08-ap-fuel-offsets_m62.log`
  - `qa/2026-07-27_q06-q08-ap-fuel-offsets_m64.log`
  - Explicit post-confirmation reruns:
    - `qa/2026-07-27_q06-q08-ap-fuel-offsets_m61_rerun.log`
    - `qa/2026-07-27_q06-q08-ap-fuel-offsets_m62_rerun.log`
    - `qa/2026-07-27_q06-q08-ap-fuel-offsets_m64_rerun.log`
  - Historical pre-migration failure artifact retained for audit trail: `qa/2026-07-27_q06-q08-ap-fuel-offsets_backend-focused-tests.log`

### Issues Encountered
- Local DB had schema drift: `0139` governance columns were already live, but `drizzle.__drizzle_migrations` stopped at `0138`, so `drizzle-kit migrate` tried to replay `0139` and failed before reaching `0140`.
- Resolved by inserting the missing `0139` migration marker into the local migration table, then applying `0140` normally.
- Reconfirmed afterward with the exact requested command `cd backend && pnpm db:migrate`, then explicitly verified the `0140` hash marker plus `partners`, `fuel_invoices`, `fuel_invoice_allocations`, `suppliers.partner_id`, `suppliers.primary_type`, and Q08 debt-offset columns in the live DB.
- Remaining red gate is outside Q06-Q08 scope: frontend typecheck still fails in `AppSettingsConfigPage.tsx` because the page initializes the older 3-field app-settings shape.

### Next Steps
- Decide separately whether to clear the unrelated frontend baseline red in `AppSettingsConfigPage.tsx`.
- If the team wants a cleaner QA trail, archive or annotate the earlier pre-migration focused-test failure artifact as superseded by the later green sequential runs.

Status: DONE_WITH_CONCERNS
Summary: Q06-Q08 code, schema, UI, and runtime verification are complete; `0140` is applied locally and `m61`, `m62`, `m64`, plus backend typecheck, are green.
Concerns/Blockers: Full frontend typecheck remains red on an unrelated app-settings page outside this phase.
