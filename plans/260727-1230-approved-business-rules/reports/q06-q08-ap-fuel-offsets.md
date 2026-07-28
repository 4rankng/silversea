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

## Controller operability follow-up

The original Q06 slice had persisted tables and approval validation but no
mounted create/read/update API, so a user could not operate the accepted
multi-truck invoice workflow. The controller added:

- finance-role list/detail endpoints;
- ACCOUNTANT/ADMIN draft creation and replacement;
- MANAGER/ADMIN approval with maker self-approval blocked;
- server-side amount calculation from actual litres × invoice unit price;
- trip/truck consistency checks and mandatory voucher references;
- partial allocation retained as `PENDING`, with approval blocked until litres
  and amounts reconcile exactly;
- one invoice header with multiple per-trip/per-truck allocation rows.

The backend compiles green in
`qa/2026-07-27_q06-fuel-invoice-operability_backend-typecheck.log`, and the
expanded M6.1 suite passes 17/17 in
`qa/2026-07-27_q06-fuel-invoice-operability_backend-test.log`.
Summary: Q06-Q08 code, schema, UI, and runtime verification are complete; `0140` is applied locally and `m61`, `m62`, `m64`, plus backend typecheck, are green.
Concerns/Blockers: Full frontend typecheck remains red on an unrelated app-settings page outside this phase.

## Q06 fuel-invoice operability follow-up

### Scope completed
- Added the frontend fuel-invoice surface directly inside `/payables` with:
  - accountant/admin draft create-edit flow;
  - manager/admin detail + approve flow;
  - responsive table/cards + detail modal + editor modal;
  - vi-VN currency display and actual-litres × unit-price line amounts;
  - explicit pending-allocation warnings and no equal-split path.
- Added frontend API/query support for fuel-invoice list/detail/create/update/approve and trip option loading.
- Hardened backend approval authority so every approved allocation must reference an existing approved fuel expense on the same trip and supplier, while still allowing incomplete drafts to remain pending.
- Added focused HTTP/RBAC regression coverage for accountant/manager/driver/customer access and evidence-link integrity.
- Updated M6.1 fuel AP reconciliation tests so approved invoices reconcile through authoritative linked fuel-expense evidence.

### Files modified in this follow-up
- `backend/src/services/fuel-invoice.service.ts`
- `backend/src/tests/m61-fuel-ap-recon.test.ts`
- `backend/src/tests/q06-fuel-invoice-routes.test.ts`
- `frontend/src/api/financialClient.ts`
- `frontend/src/api/keys.ts`
- `frontend/src/hooks/useFinancialQueries.ts`
- `frontend/src/pages/PayableListPage.tsx`
- `frontend/src/pages/payables-fuel-invoices.tsx`
- `frontend/src/pages/payables-fuel-invoices.css`
- `frontend/src/pages/payables-fuel-invoices.test.tsx`
- `shared/src/constants/api-paths.ts`

### QA artifacts
- Focused backend tests: pass
  - `qa/2026-07-27_q06-fuel-invoice-operability_backend-test.log`
- Backend typecheck: pass
  - `qa/2026-07-27_q06-fuel-invoice-operability_backend-typecheck.log`
- Focused frontend page test: pass
  - `qa/2026-07-27_q06-fuel-invoice-operability_frontend-test-rerun.log`
- Frontend typecheck: blocked by unrelated baseline
  - `qa/2026-07-27_q06-fuel-invoice-operability_frontend-typecheck-rerun.log`
  - Remaining red: `frontend/src/features/dispatch/components/DispatchTripCard.test.tsx` has an existing `TripStatus` mismatch unrelated to Q06.
- Root lint: pass with repo-wide warnings only
  - `qa/2026-07-27_q06-fuel-invoice-operability_lint-rerun.log`
- Build: pass
  - `qa/2026-07-27_q06-fuel-invoice-operability_build.log`
- Historical baseline-failure artifacts retained for audit trail
  - `qa/2026-07-27_q06-fuel-invoice-operability_backend-test.log` captured unrelated backend suite reds because `pnpm test -- ...` runs the full suite in this repo.
  - `qa/2026-07-27_q06-fuel-invoice-operability_frontend-test.log` captured unrelated frontend suite reds because `pnpm test -- ...` expands beyond the target file here.

### Remaining concerns
- Full frontend typecheck is still not globally green because of the unrelated dispatch-card baseline above.
- I did not run E2E from this subtask session; if controller wants full SDLC closure for the new approval/RBAC flow, that remains a final cross-phase check.

## Q06 voucher-integrity follow-up

### Scope completed
- Bound linked fuel-invoice allocations to authoritative approved trip-fuel-expense evidence without schema changes.
- Added save-time and approval-time revalidation for:
  - `voucherDate === trip_expenses.expenseDate`
  - `allocation amount === approved trip_expenses.buyAmount`
  - `voucherReference` matching `invoiceNumber` or `declarationNumber` when either exists
  - at least one `trip_expense_photos` row when no invoice/declaration reference exists
- Preserved incomplete draft behavior by allowing unlinked pending allocations, while rejecting approval until evidence is linked.
- Rechecked the same authority rules during approval so later source mutations or photo deletion cannot bypass save-time validation.

### Files modified in this follow-up
- `backend/src/services/fuel-invoice.service.ts`
- `backend/src/tests/q06-fuel-invoice-routes.test.ts`
- `backend/src/tests/m61-fuel-ap-recon.test.ts`

### Focused regressions added
- Save/update rejects mismatched expense date.
- Save/update rejects litre-derived amount that no longer matches approved expense amount.
- Save/update rejects voucher reference mismatch against invoice/declaration authority.
- Approval rejects no-photo fallback cases after linked photo evidence is removed post-save.
- Existing M6.1 draft-pending and approval reconciliation cases updated to the stricter linked-evidence contract.

### QA artifacts
- Focused backend tests: pass
  - `qa/2026-07-27_q06-fuel-invoice-voucher-integrity_backend-test-rerun.log`
  - retained first red-to-green run:
    - `qa/2026-07-27_q06-fuel-invoice-voucher-integrity_backend-test.log`
- Backend typecheck: pass
  - `qa/2026-07-27_q06-fuel-invoice-voucher-integrity_backend-typecheck.log`
- Root lint: pass with repo-wide warnings only
  - `qa/2026-07-27_q06-fuel-invoice-voucher-integrity_lint.log`
- Build: pass
  - `qa/2026-07-27_q06-fuel-invoice-voucher-integrity_build.log`

### Remaining concerns
- Lint still reports the same pre-existing repo warnings outside this slice; no new lint errors were introduced here.
- I did not rerun frontend/E2E for this backend-only voucher-authority follow-up.
