# Chunk-7 BE re-run — backend lane evidence (ticket 18f4a2dd)

**When:** 2026-09-10 ~22:10 +07 · **By:** backend (team run run-1789047688501)
**Environment:** local dev (silversea-db @ docker :5441), commit `ac739e37` (origin/prod tip), working tree additionally carries uncommitted T3 driver-card work (not in this verification's blast radius).
**Scope:** BE-runnable cases from `testplan/qa/2026-09-10_approval-removal-chunk7.md` (rung 2). Staging/UI cases (TC-001/002/011, staging half of 003/007/008) remain for the qa lane post-cut.

## RE-STAMP @ origin/prod HEAD 13b68a2b (2026-09-10 ~23:05 +07, pm seq 59 unblock)

Clean working tree (all lanes landed: FE teardown 8a7e6fc3 + B1 RBAC fix 13b68a2b + L0 chunks). Re-verified at this HEAD:

- TC-004 (amended grep, `getApprovalQueue` only): **0 hits** — PASS.
- TC-005 (`getApprovalQueue` in routes): **0 hits** — PASS.
- TC-006: `approval-queue.service.ts` absent; governance imports outside `governance/`: **0** — PASS.
- TC-007 DB: swept-kind pending **0** · settlements PENDING/CHECKED_BY_ACCOUNTANT **0** — PASS.
- TC-008 DB: `__drizzle_migrations` last entry = `2d8af75377` (0067 recorded) — G-mig satisfiable locally.
- Chunk-7 suites at HEAD: **84/84** (q15-direct-money · q15-profit-distribution · q23-direct-money · q03-payment-receipts · q03-payment-refund · m64-debt-offsets · q01-credit-override · governance-actions-list-sort · m73-salary-period-close · q10-salary-exclusion · q11-salary-post-close · q06-fuel-invoice · q15-debit-note · q23-approved-financial · q23-forwarder-create-replay) + `driver-journey-board-fields` 1/1 + dispatch-detail-plan 60/60 (incl. new driver-tags RBAC pin).
- **FE lockstep zero-ref sweep: PASS** — 0 hits incl. tests+CSS, evidence in `qa/2026-09-10_approval-removal-chunk7_src-009.txt`. **X1 label sweep: pending pm ruling** (retained-flow labels vs 3 stale-candidate sites, classified there).

## Results

| Case | Verdict | Evidence |
|---|---|---|
| TC-004 work-inbox rewired | **PASS** (per Amendment 2 ruling A — grep re-pinned to `getApprovalQueue`-only) | `getApprovalQueue` refs in `work-inbox.service.ts`: **0 hits** ✓. The spec's second grep (`approvalStatus.*PENDING`) has 1 hit at `:226` — ruled RETAINED: it feeds the kept accountant expense/settlement flow (see Finding 1). |
| TC-005 reports rewired | **PASS** | `grep getApprovalQueue backend/src/routes/` → 0 hits (incl. `financial/reports.routes.ts`; only an explanatory comment mentions the removed route). |
| TC-006 governance dead-code | **PASS** | No imports of `governance/transition|policy|action-core` outside governance/. `GOVERNANCE_ACTION_KINDS` referenced only in `governance/`, its tests (`q15-governance-foundation`, `q18` unit — enum-integrity assertions, acceptable) and schema. `approval-queue.service.ts` **deleted**, zero code importers (2 comment-only mentions). |
| TC-007 legacy sweep | **PASS (local)** | After applying 0067: swept-kind pending count **0** (was 81); `advance_settlements` PENDING/CHECKED_BY_ACCOUNTANT **0** (was 1); SUPERSEDED stamped rows 168 (87 from 0061 + 81 from 0067); total `governance_actions` rows unchanged in count-or-up only (no deletes). Kept kinds still pending by design: TRIP_AR_ADJUSTMENT (83), CREDIT_OVERRIDE_APPROVAL (4). |
| TC-008 migration supersede | **PASS (local) with FINDING 2** | 0061 + 0066 recorded in `drizzle.__drizzle_migrations` before; 0067 was MISSING locally → applied manually (see Finding 2). Post-fix `drizzle-kit migrate` exits 0 clean. |
| TC-003 endpoints dead | covered by suites | The spec's `/api/approval/*` route family does not exist. The live `/api/financial/governance-actions/:id/{check,approve,reject,return-for-evidence,cancel}` endpoints are the RETAINED maker-checker engine (see Finding 1b) — staging curl probe still owed by qa. |
| pm item 3 — no NEW pending approvals creatable | **PASS (static + DB)** | Every swept-kind insert site terminates the action in-request: direct-money + quartet kinds → `autoApplyGovernanceAction` in payments/advances/penalties/debt-offsets/expense/fuel-invoices/billing-documents/reports routes (chunk 4); SALARY_* family → `autoApplySalaryGovernance` single-actor chains (chunk 3, `routes/salary.ts`); COMMISSION → via `payments.routes.ts`. Retained by explicit design: TRIP_EXPENSE_APPROVAL (accountant maker-checker, `approval.service.ts:129` comment), CREDIT_OVERRIDE tier escalation (`credit-overrides.routes.ts` comment). |

## Test suites re-run (all green)

- q15-direct-money-governance · q15-profit-distribution-governance · q23-direct-money-idempotency · q03-payment-receipts-route · q03-payment-refund-route · m64-debt-offsets · q01-credit-override-routes · governance-actions-list-sort → **55/55**
- m73-salary-period-close · q10-salary-exclusion-routes · q11-salary-post-close · q06-fuel-invoice-routes · q15-debit-note-governance · q23-approved-financial-idempotency · q23-forwarder-create-replay → **29/29**
- backend `tsc --noEmit` clean.

## Finding 1 — TC-004 second grep over-broad → RESOLVED by Amendment 2 ruling A

`work-inbox.service.ts:226` queries `tripExpenses.approvalStatus='PENDING'` inside **financialWorkInbox** (ACCOUNTANT inbox) to render the blocker "Chi phí đang chờ phê duyệt" / `expenseApprovalPending` flag. Chunk-7's diff (ac739e37) deliberately left financialWorkInbox untouched and only removed the manager approval-queue leg. The trip-expense approval concept is **alive by design**: expenses enter PENDING on forwarder sell-amount edits (`forwarder.service.ts:543`) and exit via settlement approval (`advance-settlement.service.ts:727-729`); the master checklist names no expense-approval removal clause and X1 scopes to the UI.

**Ruling (pm, Amendment 2 A, 2026-09-10):** TC-004's grep re-pins to `getApprovalQueue`-only; the `:226` expense blocker STAYS as a retained-flow signal. No code change.

**1b — RESOLVED by Amendment 2 ruling B:** `/governance-actions/:id/check|approve` endpoints are RETAINED by design for the kept flows (TRIP_EXPENSE maker-checker, CREDIT_OVERRIDE tier escalation, TRIP_AR adjustments). No new scope.

## Finding 2 — `drizzle-kit migrate` silently exits 1 on 0067 (deploy risk)

`npx drizzle-kit migrate` (drizzle-kit 0.31.10) applies 0066 then exits **1 with no error output** (none even under `DEBUG="*"`), leaving 0067 unapplied and unrecorded. The SQL itself is sound — `psql -v ON_ERROR_STOP=1` applied both statements cleanly (UPDATE 81, UPDATE 1). Locally resolved by applying via psql and inserting the journal row (`sha256 2d8af75377…`, when=1789069320000); subsequent `drizzle-kit migrate` exits 0.

**Staging impact:** if the staging boot/deploy path uses `drizzle-kit migrate`, 0067 may silently not apply there — TC-007's staging queries would then fail. Deploy owner must verify post-cut that `drizzle.__drizzle_migrations` contains hash prefix `2d8af75377` (or the swept-count query returns 0).

**Adopted as hard deploy gate G-mig (pm, Amendment 2, 2026-09-10):** staging AND prod cuts verify the `2d8af75377` migration hash after migrate, before QA handoff.

## DB safety

Backup taken before manual apply: `docker exec silversea-db pg_dump -U postgres -Fc silversea` → `/tmp/silversea-db-backups/pre-0067-215730.dump` (9.7 MB).
