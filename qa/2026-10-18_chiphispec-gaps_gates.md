# QA — 2026-10-18 — chiphispec gaps (card 191026100030) — gates

Branch `fix-chiphispec-gaps-rb2` (worktree; REDO of the dead
`fix-chiphispec-gaps-rb1` run whose gates were green but which died before
commit+push — change-set reconstructed from its reviewed final state). All
runs local dev DB (Postgres :5441), Node/tsx + vitest. Exact commands, outputs,
exit statuses.

## Typecheck

|Gate|Command|Result|
|---|---|---|
|BE tsc|`cd backend && pnpm exec tsc --noEmit`|exit 0, 0 errors (83.7s)|
|FE tsc|`cd frontend && npx tsc -b`|exit 0, 0 errors (83.6s)|

## FE scoped tests

1. `cd frontend && npx vitest run src/components/trip/ShipmentCostEntryForm.test.tsx
   src/components/trip/ShipmentCostEntryDraft.test.tsx
   src/components/trip/DriverExpenseCorrection.test.tsx
   src/pages/DriverTripDetailPage.shipmentCostEntry.test.tsx`
   → `Test Files 4 passed (4) · Tests 48 passed (48)`, exit 0.
2. `cd frontend && npx vitest run src/features/expense-accounting/ExpenseCreateDrawer.test.tsx
   src/pages/accounting/DepositRefundTrackerPage.test.tsx
   src/pages/accounting/DepositRefundTrackerPage.alerts.test.tsx
   src/pages/ShipmentDebitPage.test.tsx
   src/features/shipments/debit
   src/pages/accounting/AccountingDebitClosePage.test.tsx`
   → `Test Files 11 passed (11) · Tests 144 passed (144)`, exit 0.
3. §2 dup-warning evidence — `cd frontend && npx vitest run
   src/features/ops/OpsExpenseFormModal.containers.test.tsx`
   → `Tests 15 passed (15)`, exit 0.

## BE tests (tsx --test)

1. Items 2+3 + item 1 driver classification — `cd backend && pnpm exec tsx --test
   src/tests/deposit-bill-suggestions.test.ts
   src/tests/ops-expense-duplicate-warning.test.ts
   src/tests/card6-driver-lot-cost-classification.test.ts
   src/tests/card164-driver-no-invoice-lot-cost.test.ts
   src/tests/m84-incidental-cost.test.ts`
   → `tests 40 · pass 40 · fail 0` (deposit/dup 12 + driver trio 28).
2. Item 6 regression + phoi board suite — the scoped combined gate —
   `cd backend && pnpm exec tsx --test
   src/tests/lotless-trip-read-fallback.test.ts
   src/tests/phoi-phieu-control.test.ts`
   → `tests 49 · pass 49 · fail 0` (42 phoi-phieu-control + 7 lotless), exit 0.
3. Sibling suites of the phoi-phieu/lock/work edits —
   `cd backend && pnpm exec tsx --test
   src/tests/phoi-phieu-chiho-trip-source.test.ts
   src/tests/accounting-command-boundaries.test.ts
   src/tests/expense-accounting-work-remediation.test.ts
   src/tests/shipment-accounting-lock.test.ts
   src/tests/expense-source-fulfillment-trip-read.test.ts
   src/tests/expense-source-fulfillment-trip.test.ts`
   → `tests 27 · pass 27 · fail 0`.
4. Remaining affected suites —
   `cd backend && pnpm exec tsx --test src/tests/card170-phoi-phieu-voucher-reference.test.ts
   src/tests/card172-container-payload.test.ts
   src/tests/card173-report-order-aggregate.test.ts
   src/tests/card181-signed-expense-total.test.ts
   src/tests/card197-negative-cost-totals.test.ts
   src/tests/card8-truck-assignments.test.ts
   src/tests/debit-voided-expenses.test.ts
   src/tests/phoi-phieu-fixture-marker-filter.test.ts
   src/tests/phoi-phieu-search-projection.test.ts
   src/tests/phoi-phieu-soft-delete-leak.test.ts`
   → `tests 55 · pass 54 · fail 1` ×3 parallel runs — one environment-class
   red, see "Parallel-run notes" below. Serialized rerun of the interacting
   set (`--test-concurrency=1`, card197 + 3 phoi siblings) →
   `tests 28 · pass 28 · fail 0`; `card197-negative-cost-totals.test.ts`
   alone → `tests 10 · pass 10 · fail 0`.

## Lint

`pnpm lint` — first run: 1 error PRE-EXISTING on the base branch in a file
this lane never touched (`cus-lcl-undated-parity-d6.test.ts:16 unused eq`;
the sibling `ShipmentExpensePanel.test.tsx` unused-import error the original
lane saw was already fixed on base 20d4cb27 by a parallel lane). Forward fix:
removed the unused import (no behavior change). Re-run:

```
> tingting@ lint … > eslint .
(no output — 0 errors)
exit 0
```

## Parallel-run notes (environment class — not reds against this change-set)

1. **`loadExpenseAccountingEntries` global hydration 409 on stale sources =
   environment note, not a red.** The UNFILTERED work-list read hydrates every
   expense source in the shared dev DB, and node:test runs files in parallel —
   a sibling suite's mid-teardown stale source trips
   `hydrateExpenseAccountingSource`'s designed 409 (`Nguồn chi phí không còn
   lô hàng/khách hàng hợp lệ.`) for the whole screen. The lotless works-list
   probe is therefore lot-scoped (same join, deterministic). Observed
   environment limit (not this card): one stale source row makes the
   UNFILTERED /accounting/expenses read throw 409 for the whole screen —
   designed guard, but worth a card if QA hits it on staging.
2. **`card197-negative-cost-totals` TỔNG CỘNG equality vs parallel siblings =
   environment note, not a red.** The `report` case compares
   `getPhoiPhieuReport` grand totals across two reads inside one test; when
   the 10-file batch runs in parallel, a sibling file's fixture write lands
   between the reads and shifts the companywide grand (observed delta
   +150.000đ = the `amount: '150000'` fixture shapes in
   `phoi-phieu-fixture-marker-filter`/`phoi-phieu-soft-delete-leak`).
   Repro matrix: solo 10/10 green; each pair green; 3-4 file parallel red ×3
   (twice on the full batch, once on the 4-file subset); serialized
   (`--test-concurrency=1`) 28/28 green. This change-set does not touch the
   grand computation or bucketing (the coalesce join only resolves party
   name/ghiChu; rows never enter/leave the grand), so the race is pre-existing
   test fragility over the shared dev DB — the same class as note 1. Worth a
   scoping card (assert the fixture's own party row, not the companywide
   grand) if the batch keeps meeting it.

## Change-set provenance

The diff is the reviewed final state of the lost `fix-chiphispec-gaps-rb1`
run: its independent code-reviewer pass (contract §2) returned PASS WITH MINOR
FINDINGS (2 minor + 4 nits, no blockers) and every finding is already resolved
in this change-set — per-row tolerant teardown + house time+entropy fixture
tags in the new suite, the 7th case (THU report ghiChu attribution pin), the
`updatePhoiPhieuMeta` dead `trips` probe deleted, the two parity-edge comment
lines on `receiptStillNeeded`, the money-wrap comment corrected, and the
testplan Gate list completed.

## UI verification coverage (contract §9)

|Claim / bug|Rung|Evidence|Not covered|
|---|---|---|---|
|CP-GAP-01/02/03 driver cost gate + correction contract|CODE-READ ONLY + automated DOM tests|FE suites in §FE scoped tests 1 (48/48)|No real browser drive (no staging account/session in this lane); screenshots not captured|
|CP-GAP-05 chốt-debit polish|CODE-READ ONLY + style-contract tests|§FE scoped tests 2 (144/144)|No visual screenshot at 390/768/1440|
|CP-GAP-04 lotless-trip reads|DB/API VERIFIED (BE tests against dev DB, 7/7 + combined 49/49 + siblings 27/27)|§BE tests 2-3|No UI drive of the phơi phiếu board on a hàng-lẻ lot|
|§3a/§3b verify (hoàn cược, khoản chi gọn)|CODE-READ ONLY + automated DOM/BE tests|§FE scoped 2 (144/144) + §BE 1 (40/40)|No live drive|
