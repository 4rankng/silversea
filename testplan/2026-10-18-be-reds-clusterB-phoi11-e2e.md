# Red-at-base wave — cluster B: PHOI-11 provenance read identity + E2E warn-contract fixture (regression case)

Case ID: TC-REDSB1 (QA-AUDIT-PHOI-11 ×3) / TC-REDSB2 (E2E suite ×2)
Feature: backend suite health at base `20d4cb27` on `fix-be-reds-phoi-e2e-rb1` —
full integration run 3352 tests / 3335 pass / 17 fail (unit 305/305). Cluster B
owns 5 of them: `expense-source-remediation.test.ts` (QA-AUDIT-PHOI-11
CATALOG/NORM/LEGACY) and `comprehensive.test.ts` (E2E Trip dispatch lifecycle +
its Financial-operations cascade). The other 12 base reds belong to other
clusters' waves (quotation/heSo ×4 = surcharge-rounding, salary q11/q15 ×3,
dispatch-fulfillment FB-018, photo-trip-scope ×2, q23, tool-executables) and
are untouched here.

Cards: QA-AUDIT-PHOI-11 (testplan/cycles/2026-10/2026-10-01-user-todo-follow-up.md),
card 20261005_373 "lần 2" (`2a64156f`, row-identity fix), FB-038 family /
ticket 111026105630 / card 171026121100 (rig-overlap warn-once + confirm),
pre-existing-failure record: docs/consolidation-plan-2026-10-15.md line 155
(QA-AUDIT-PHOI-11 ×3).

## Diagnosis (verified from red output, not inferred)

### TC-REDSB1 — QA-AUDIT-PHOI-11 ×3 (fixture id-drift)
NOT a provenance-service defect. The correction service preserves every original
driver fact on the replacement native head
(`expense-accounting-correction.service.ts:50-52` copies driverEnteredAmount /
expenseTypeCode / feeNormCode / costType, and
`expense-accounting-source.service.ts:173` syncs costGroup/feeName/invoice*
/ recoveryNote / payerKind / photoStorageKeys down for DRIVER sources), and the
active-read subcase asserts those successfully — it fails later, at the row
IDENTITY assert (`expense-source-remediation.test.ts:161`):

    + actual - expected
      [ 5715,
  +   22853      ← expense_accounting_sources.id of the active replacement
  -   5716 ]     ← driver_incidental_costs.id the fixture still expects

`getPhoiPhieuTienDuong` rows have keyed `sourceId` on
`expense_accounting_sources.id` since card 20261005_373 "lần 2" (the "Từ chối"
dialog 404 fix; `phoi-phieu-control.service.ts:1004-1041` projects
`sourceTableId` and falls back to the cost id only for a genuinely unlinked
legacy cost). The shipped contract is pinned by
`phoi-phieu-control.test.ts:254` (`read.rows[0]!.sourceId === source.id`). The
QA-AUDIT-PHOI-11 fixture predates that identity change and still asserts the
driver-cost ids for the LINKED head — a fixture drift, exactly the class wave 1
TC-REDSW1-02 item 2 documented for card197.

### TC-REDSB2 — comprehensive.test.ts E2E ×2 (warn-contract fixture drift)
NOT a trip-create defect. `POST /api/trips` returned the rig-overlap warn tier:

    409 { error: 'Tài xế đã có 1 chuyến khác trùng khung giờ phân công này. Vẫn lưu?',
          code: 'RIG_OVERLAP_COMPLETED' }

The FB-038-family warn-once contract (`dispatch-plan-conflict-scan.service.ts:485-507`,
`trip-create.service.ts:105` `confirmOverlap`) postdates the E2E fixture: a
grown dev-DB holder trip on the fixture's picked driver raises the warn, and the
documented confirmed retry (`createTripSchema.confirmOverlap`, shared
`schemas/index.ts:192-193` — "the retried create rides the warn tier instead of
surfacing it again", mirroring `rigOverlapCompletedConfirmed` on dispatch flows)
is what makes the save land. The E2E sends only the unconfirmed first attempt
and asserts 201 (`comprehensive.test.ts:396`). The Financial-operations red is a
cascade: the lifecycle test never reaches `tripId = createRes.data.id`, so the
next test queries `select "version" from "trips" where "trips"."id" = undefined`
(`comprehensive.test.ts:606`, UNDEFINED_VALUE).

### TC-REDSB3 — advance-draft-recovery order-fragile "last audit" read (gate-run only)
Surfaced by the cluster-B gate run (green at the base run and green in
isolation, 8/8): `state()` selected `auditLogs` with no ORDER BY and the suite
asserted `audit.at(-1)` as "the last audit" — Postgres heap order, not
insertion order. The full suite's earlier files churn `audit_logs` (the E2E
Financial-operations cascade fix alone now runs its full money flow where it
previously crashed at its first query), and free-space reuse flipped the two
row order: actual `'Đã ghi sổ tạm ứng cũ'` vs expected `'Đã hủy tạm ứng chưa
giao tiền'` (`advance-draft-recovery.test.ts:87`). Not a product defect and not
a logic error in the suite — an unstable fixture read. Fix: the helper reads
audits in insertion order (`orderBy(asc(id))`); every assertion keeps its
content.

## Fix
Test-side only; no product code changed. Same precedent as wave-1 TC-REDSW1-02
and cluster A's `duplicateConfirmed` fixtures (a50a98e6).
- `expense-source-remediation.test.ts`: the active-read subcase keys the linked
  head on its accounting-source id (`active.id`, the replacement source the
  correction returns) and keeps the documented native-id fallback for the
  genuinely unlinked legacy row. Every provenance assertion (driverEnteredAmount
  zero/null/10000110000, expenseTypeCode, feeNormCode, cost type, driver/trip,
  receipt, metadata, VOIDED history, evidence singleton, ledger net) unchanged.
- `comprehensive.test.ts`: every guard-running lifecycle call carries the
  documented confirmed-retry key of the FB-038-family warn-once contract —
  create (`confirmOverlap`, `createTripSchema`), reassign
  (`rigOverlapCompletedConfirmed`, the FE reassign dialog's existing flag),
  pre-departure and actuals (`confirmOverlap`, `updateTripFiguresSchema`).
  The warn tier itself stays pinned by its own suites (`dispatch-overlap-*`,
  `trip-overlap-warning`, `dispatch-plan-conflict-scan` family).
- `cus-lcl-undated-parity-d6.test.ts`: drop the unused `eq` import — pre-
  existing root-lint red at base (stray from the card 181026185900 D.6 land),
  same gate cleanup class as a50a98e6. Suite stays 3/3.

No skip, stub, mask or deleted assertion: the fixture changes move fixtures to
the shipped contracts with the contract's own documented keys.

## Repro
1. `cd backend && npx tsx --test --test-concurrency=1 src/tests/expense-source-remediation.test.ts src/tests/comprehensive.test.ts`
   at base `20d4cb27` → 5 fail (PHOI-11 ×3 at :161 id-set deepEqual; E2E
   lifecycle 409≠201 at :396; Financial operations UNDEFINED_VALUE at :606).
   Evidence: `qa/2026-10-18_be-reds-clusterB_targeted-red-base.log`.
2. Full-suite red-before evidence:
   `qa/2026-10-18_be-reds-clusterB_full-suite-base.log` (17 reds listed under
   `✖ failing tests:`).

## Expected
- expense-source-remediation: 12/12 pass, incl. QA-AUDIT-PHOI-11 CATALOG/NORM/
  LEGACY with original driver facts preserved across correction + forward
  correction and Tiền đường reading active-replacement-only.
- comprehensive: 7/7 pass (lifecycle creates/dispatches/locks/cancels; Financial
  operations runs against the real created trip).
- Gates: backend `tsc --noEmit` 0, frontend `tsc -b` 0, root `pnpm lint` 0,
  full BE suite: cluster B green and the other 12 base reds unchanged (no new
  reds).

## Evidence
- `qa/2026-10-18_be-reds-clusterB_full-suite-base.log` (red-before, full)
- `qa/2026-10-18_be-reds-clusterB_targeted-red-base.log` (red-before, targeted)
- `qa/2026-10-18_be-reds-clusterB_targeted-green.log` (green-after, targeted:
  20/20)
- `qa/2026-10-18_be-reds-clusterB_full-suite-after.log` (gate run 1:
  3352/3342/10 — surfaced TC-REDSB3)
- `qa/2026-10-18_be-reds-clusterB_full-suite-final.log` (final: unit
  305/305/0, integration 3352/3344/8 — cluster B green, the 8 remaining are a
  strict subset of the base reds, zero new reds)
- `qa/2026-10-18_be-reds-clusterB_gates-summary.md` (commands, exit statuses,
  verbatim counts)

## Not covered / out of scope
- The other-cluster base reds are untouched: 8 remain in the final run —
  quotation/heSo ×4 (surcharge/chiphispec worktrees), FB-018 dispatch-fulfillment,
  photo-trip-scope ×2, q23 — plus q11-salary-post-close ×2 and
  tool-executables-import-inert, which flipped green state-sensitively between
  runs (order/heap-sensitive on the shared dev DB; no cause claimed here).
  TC-REDSB3's advance-draft-recovery is the one exception: its root cause (an
  unordered "last audit" read) was in the gate's red set, so its read was made
  deterministic — assertion content unchanged.
- The warn-once contract itself is not re-pinned here (owned by its suites);
  the E2E only rides its documented confirm key.
