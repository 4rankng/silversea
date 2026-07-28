# Q12/Q13 Final Closure

Date: 2026-07-28
Owner: Codex Q12/Q13 closure lane
Scope: reachable no-invoice category/config boundaries, shipment-or-trip proof, and policy-configurable approval-title routing

## What changed

- Added category-level approval-title persistence on `forwarder_expense_types`:
  - `no_invoice_finance_lead_approval_title`
  - `no_invoice_director_approval_title`
- Extended no-invoice policy normalization so defaults remain validated at the config boundary and policy version only increments when the no-invoice policy actually changes.
- Switched no-invoice approval routing from hard-coded titles to the configured category policy.
- Exposed a reachable `noInvoicePolicySnapshot` on:
  - `/api/catalogs/bootstrap`
  - `/api/forwarder/me/expense-types`
- Exposed `shipmentId` on the no-invoice disbursement report item boundary so shipment-linked proof is returned, not inferred.
- Registered migration `0149_q12_q13_policy_titles.sql` in the Drizzle migration journal and applied it locally.

## Requirement closure

### Q12

- Default accepted business labels are now proved through the seeded config/bootstrap boundary:
  - `LIFTING`
  - `INFRASTRUCTURE`
  - `INSPECTION`
  - `OTHER`
- The forwarder category route now exposes the same snapshot, so the category boundary is reachable for real portal callers.
- The accepted mandatory scope is returned explicitly as `TRIP_OR_SHIPMENT`.
- Shipment-linked no-invoice expenses now return `shipmentId` in the report boundary, proving the shipment/lot side rather than only trip-rooted internal state.

### Q13

- Per-category approval titles are now stored and validated at the config boundary.
- Defaults remain:
  - `FINANCE_LEAD`
  - `DIRECTOR`
- Approval routing now uses the configured title values from the category policy snapshot instead of fixed constants.
- Config no-op updates preserve `noInvoicePolicyVersion`; real policy changes increment it.

## Files changed

- `backend/drizzle/0149_q12_q13_policy_titles.sql`
- `backend/drizzle/meta/_journal.json`
- `backend/src/db/schema.ts`
- `backend/src/routes/config.ts`
- `backend/src/routes/forwarder.ts`
- `backend/src/services/config.service.ts`
- `backend/src/services/no-invoice-disbursement.service.ts`
- `backend/src/tests/m47-no-invoice-disbursement.test.ts`
- `backend/src/tests/q12-q13-no-invoice-boundary-routes.test.ts`
- `shared/src/schemas/index.ts`

## QA artifacts

- `qa/2026-07-28_q12-q13-final_shared-build.log`
- `qa/2026-07-28_q12-q13-final_backend-typecheck.log`
- `qa/2026-07-28_q12-q13-final_backend-typecheck-rerun.log`
- `qa/2026-07-28_q12-q13-final_migrate.log`
- `qa/2026-07-28_q12-q13-final_migrate-rerun.log`
- `qa/2026-07-28_q12-q13-final_migrate-rerun2.log`
- `qa/2026-07-28_q12-q13-final_backend-test.log` (red pre-journal fix)
- `qa/2026-07-28_q12-q13-final_backend-test-rerun.log` (red pre-journal fix)
- `qa/2026-07-28_q12-q13-final_backend-test-rerun2.log` (logic green, combined-process teardown issue)
- `qa/2026-07-28_q12-q13-final_backend-test-rerun3.log` (combined-process teardown issue isolated)
- `qa/2026-07-28_q12-q13-final_m47-backend-test.log`
- `qa/2026-07-28_q12-q13-final_routes-backend-test.log` (red teardown ordering)
- `qa/2026-07-28_q12-q13-final_routes-backend-test-rerun.log` (red keep-alive / redis teardown)
- `qa/2026-07-28_q12-q13-final_routes-backend-test-rerun2.log` (red redis teardown)
- `qa/2026-07-28_q12-q13-final_routes-backend-test-rerun3.log`

## Final verification

- Shared build: green
- Backend typecheck: green
- Focused no-invoice service/report tests: 32 passed, 0 failed
- Focused route boundary tests: 4 passed, 0 failed

## Residual note

- This lane closes the exact Q12/Q13 gaps called out in `final-audit-q12-q23-o01-o02.md`.
- It does not claim closure for the other still-open audit items outside Q12/Q13.
