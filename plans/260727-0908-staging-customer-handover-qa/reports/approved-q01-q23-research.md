# Approved Q01-Q23 Coverage Audit

Scope: read-only audit of the approved TingTing business rules against current Silversea repo truth. I cross-checked `docs/prd/business-logic-qa-proposals.md`, `ROADMAP.md`, `plans/260727-1230-approved-business-rules/plan.md`, the phase-7 follow-up, schema, routes, services, and tests. Status labels are only:

- `implemented and proved`
- `partially implemented`
- `missing`

## Executive Summary

- Implemented and proved: `Q01`, `Q03`, `Q07`, `Q09`, `Q11`, `Q12`, `Q15`, `Q16`
- Partially implemented: `Q02`, `Q04`, `Q05`, `Q06`, `Q08`, `Q10`, `Q13`, `Q14`, `Q17`, `Q18`, `Q19`, `Q20`, `Q21`, `Q22`, `Q23`, `O01`, `O02`
- Missing: none that I could prove as completely absent; the gaps are mostly incomplete policy/surface coverage, not zero code

The repo already has strong foundation work in credit limit enforcement, payment allocation, supplier typing, salary close, no-invoice controls, customer scoping, idempotency, and handoff lifecycle data. The largest remaining risks are rule families that need cross-cutting policy enforcement rather than isolated helper functions.

## Coverage Matrix

| ID | Status | Current evidence | Ordering / dependency note |
|---|---|---|---|
| Q01 | implemented and proved | `backend/src/services/credit-limit.service.ts`, `backend/src/tests/m53-credit-limit.test.ts`, `backend/src/db/schema.ts` | Baseline for Q02; threshold is already customer-driven with default warning logic. |
| Q02 | partially implemented | `backend/src/services/credit-limit.service.ts`, `backend/src/tests/m53-credit-limit.test.ts` | Helper supports override, but I did not find a dedicated approval workflow or explicit tier-routing surface. |
| Q03 | implemented and proved | `backend/src/services/payment-allocation.service.ts`, `backend/src/tests/m56-payment-allocation.test.ts`, `backend/src/db/schema.ts` | Stable prerequisite for reminder/reconciliation behavior. |
| Q04 | partially implemented | `backend/src/services/receivable-reminder.service.ts`, `backend/src/scheduler/runner.ts`, `backend/src/tests/m57-receivable-reminder.test.ts` | Daily reminder exists, but exact T-3 / due-date / T+3 / quiet-hours / holiday rules are not fully proven. |
| Q05 | partially implemented | `backend/src/services/email.service.ts`, `backend/src/services/receivable-reminder.service.ts`, `backend/src/tests/m57-receivable-reminder.test.ts`, `backend/src/tests/email-service.test.ts` | Email + in-app is present, but retry/fallback behavior is not the full approved channel policy. |
| Q06 | partially implemented | `backend/src/services/fuel-ap-recon.service.ts`, `backend/src/tests/m61-fuel-ap-recon.test.ts`, `backend/src/db/schema.ts` | Reconciliation report exists, not a fully specified multi-truck invoice allocation model. |
| Q07 | implemented and proved | `backend/src/tests/m62-supplier-types.test.ts`, `backend/src/services/supplier-types.service.ts`, `backend/src/db/schema.ts` | Multi-type supplier taxonomy is enforced and tested. |
| Q08 | partially implemented | `backend/src/services/debtOffset.service.ts`, `backend/src/tests/m64-debt-offsets.test.ts`, `backend/src/services/config.service.ts` | Duality/offset mechanics exist, but the full legal-entity + currency + approval gate is not explicit end-to-end. |
| Q09 | implemented and proved | `backend/src/services/salary-period-close.service.ts`, `backend/src/tests/m73-salary-period-close.test.ts` | Company-period close is in place and idempotent. |
| Q10 | partially implemented | `backend/src/services/salary-period-close.service.ts`, `backend/src/services/salary-period.service.ts`, `backend/src/tests/m73-salary-period-close.test.ts` | Close exists, but I did not find a proof that any money-affecting driver error blocks the entire period by default. |
| Q11 | implemented and proved | `backend/src/services/salary-period-close.service.ts`, `backend/src/tests/m73-salary-period-close.test.ts` | Reopen-by-adjustment behavior is implemented and role-gated. |
| Q12 | implemented and proved | `backend/src/services/no-invoice-disbursement.service.ts`, `backend/src/services/invoice-required.service.ts`, `backend/src/tests/m47-no-invoice-disbursement.test.ts`, `backend/src/tests/m37-invoice-required.test.ts` | Category and evidence rules are enforced with tests. |
| Q13 | partially implemented | `backend/src/services/no-invoice-disbursement.service.ts`, `backend/src/tests/m47-no-invoice-disbursement.test.ts` | Per-item threshold exists, but the approved per-day/person/category anti-splitting rule is explicitly not fully enforced. |
| Q14 | partially implemented | `backend/src/services/no-invoice-disbursement.service.ts`, `backend/src/services/approval.service.ts`, `backend/src/tests/m47-no-invoice-disbursement.test.ts` | Over-threshold routing exists, but the missing-evidence vs approval path is not fully separated in every surface. |
| Q15 | implemented and proved | `backend/src/lib/scoped-by-customer.ts`, `backend/src/tests/scoped-by-customer.test.ts`, `backend/src/tests/shipment-rbac.test.ts` | Maker/checker separation is present across the sensitive surfaces I checked. |
| Q16 | implemented and proved | `backend/src/routes/portal/index.ts`, `backend/src/tests/customer-portal-routes.test.ts`, `backend/src/tests/cross-customer-isolation.test.ts` | Customer portal scoping is one-customer-per-account by default and enforced by route tests. |
| Q17 | partially implemented | `frontend/src/App.tsx`, `frontend/src/pages/clerk/ClerkShipmentCreatePage.tsx`, `frontend/src/pages/clerk/ClerkShipmentDocsPage.tsx`, `backend/src/routes/shipments.ts` | Clerk create/edit surfaces exist, but the full editable boundary is not a complete policy object yet. |
| Q18 | partially implemented | `backend/src/services/debit-note-lifecycle.service.ts`, `backend/src/services/billingDocument.service.ts`, `backend/src/services/trip-mutations.service.ts`, `backend/src/services/financial.service.ts` | Locked-data adjustment patterns exist, but not every approved data class is proven append-only with reason/before-after/approver metadata. |
| Q19 | partially implemented | `backend/src/services/salary-period.service.ts`, `backend/src/services/idempotency.service.ts`, `backend/src/routes/shipments.ts` | I did not find a verified workday/holiday rollover contract across all affected date paths. |
| Q20 | partially implemented | `backend/src/services/trip-mutations.service.ts`, `backend/src/services/financial.service.ts`, `backend/src/services/salary-period.service.ts` | Completion-date and period logic exist, but the exact cross-period attribution rule is not proven end-to-end. |
| Q21 | partially implemented | `backend/src/services/salary-period-close.service.ts`, `backend/src/services/salary-period.service.ts`, `backend/src/services/debit-note-lifecycle.service.ts` | Monthly close exists, but the approved universal lock granularity is not fully consistent across modules. |
| Q22 | partially implemented | `backend/src/services/trip-mutations.service.ts`, `backend/src/services/billingDocument.service.ts`, `backend/src/services/financial.service.ts`, `backend/src/services/debit-note-lifecycle.service.ts` | Source-of-truth and recompute/adjustment patterns exist, but not as one explicit end-to-end contract. |
| Q23 | partially implemented | `backend/src/services/idempotency.service.ts`, `backend/src/routes/shipments.ts`, `frontend/src/lib/offline-queue.ts`, `backend/src/services/dispatch-handoff.service.ts`, `backend/src/tests/shipment-quick-create.test.ts`, `frontend/src/lib/offline-queue.test.ts`, `backend/src/tests/m103-handoff-service.test.ts` | Strong per-surface protection exists; I did not verify a single universal rule across every write path. |
| O01 | partially implemented | `backend/src/services/dispatch-handoff.service.ts`, `backend/src/db/schema.ts`, `backend/src/tests/m103-handoff-service.test.ts`, `backend/src/tests/wave4-handoffs-schema.test.ts` | Data model and service exist, but no dedicated route/frontend flow for actual two-way dispatch pairing was found. |
| O02 | partially implemented | `backend/src/index.ts`, `backend/src/services/agent/tools/audit.ts`, `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/hooks/useAuditLogs.ts`, `frontend/src/features/dashboard/hooks/useDashboardData.ts` | Backend/API access exists for ACCOUNTANT, but frontend discoverability is incomplete because the nav item is still hidden from ACCOUNTANT in `Layout.tsx`. |

## Plan Review

### Phase 1 to 6

- The phase split is directionally sound. It matches the actual dependency graph in the repo: credit/payment/reminder work, supplier/fuel/AP work, payroll-close work, and no-invoice approvals all sit on different service layers.
- The risky part is not the ordering; it is assuming each approved rule is already a fully global contract when some are only proven on one or two surfaces.

### Phase 7: Two-way dispatch and audit access

- `plans/260727-1230-approved-business-rules/phase-07-two-way-dispatch-and-audit-access.md:13-21` is too strong for `O01` if read literally. The repo has dispatch handoff schema/service/tests, but I found no dedicated route or frontend pairing workflow yet.
- The same phase is mostly correct for `O02`, but it should explicitly require both API access and UI discoverability for ACCOUNTANT. `frontend/src/App.tsx:245` allows the page, while `frontend/src/components/Layout.tsx:90-92` still hides the audit-log nav item from ACCOUNTANT.
- `plans/260727-1230-approved-business-rules/phase-07-two-way-dispatch-and-audit-access.md:34-35` should not imply audit visibility is done just because the backend is readable; frontend navigation parity is still a gap.

### Missing Dependencies / Unsafe Assumptions

- `O01` depends on a trip/order/vehicle pairing model that is not yet visible in the current route surface. The plan should treat schedule/location/capacity/cargo fields as blocking inputs, not as implicit existing data.
- `Q23` should stay scoped as per-surface idempotency and conflict handling until a universal write contract is actually present.
- `Q17` and `Q18` both depend on a locked-data model. The plan should explicitly separate "edit in place" from "adjustment record" behavior so later phases do not silently diverge.

## Highest-Risk Contracts

1. `backend/src/db/schema.ts`
2. `backend/src/routes/shipments.ts`
3. `backend/src/routes/portal/index.ts`
4. `backend/src/services/dispatch-handoff.service.ts`
5. `backend/src/services/no-invoice-disbursement.service.ts`
6. `backend/src/services/salary-period-close.service.ts`
7. `backend/src/services/idempotency.service.ts`
8. `frontend/src/App.tsx`
9. `frontend/src/components/Layout.tsx`
10. `backend/drizzle/0117_new_power_man.sql`
11. `backend/drizzle/0121_yellow_molecule_man.sql`
12. `backend/drizzle/0126_public_valkyrie.sql`

These are the places where a small schema or guard change can invalidate a lot of rule coverage.

## Recommended Dependency Order

If the goal is to close the remaining gaps with minimum rework, I would land the families in this order:

1. `Q01` -> `Q02`
2. `Q03` -> `Q04` -> `Q05`
3. `Q06` -> `Q07` -> `Q08`
4. `Q09` -> `Q10` -> `Q11`
5. `Q12` -> `Q13` -> `Q14`
6. `Q15` -> `Q16` -> `Q17` -> `Q18`
7. `Q19` -> `Q20` -> `Q21` -> `Q22` -> `Q23`
8. `O02` before or alongside `O01` if the goal is to reduce user-visible risk fast; `O01` is the heavier dependency because it needs a fuller pairing model and a surface to operate it from

## Bottom Line

The approved rule set is not "mostly missing"; it is mostly partially implemented with a few well-proved anchors. The fastest path is to preserve the already-proved service contracts, then tighten the partially implemented families by adding explicit policy surfaces and UI parity where the repo currently relies on comments or implied behavior.
