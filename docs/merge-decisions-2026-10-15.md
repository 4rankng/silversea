# Merge decisions — integration/fleet-1015 consolidation (2026-10-15)

Execution of `docs/consolidation-plan-2026-10-15.md` (cf1f631b) in the
integration worktree `/Volumes/LexarSSD/projects/silversea-integration`.
Order was changed by the merge owner mid-flight (2026-10-15): waves first,
Ghostty last — the reverse of the plan's §5 recommendation. Authority: the
owner's explicit instruction; the plan's per-feature matrix still governs
collision outcomes.

## 1. Lineage landed on `integration/fleet-1015`

| Merge commit | Branch | Notes |
|---|---|---|
| `76010d44` | fix/qa-new-batch-1014 | pre-existing (before takeover) |
| `c4f9dc0d` | fix/cost-permissions-bugs (wave A, CPB-01 only) | pre-existing |
| `94f4fee3` | feat/hero-illustration (`2c01b0d7`) | pre-existing; wired `<picture>` set |
| `290b7c09` | feat/timesheet-hoancuoc (`a9330bf6`, wave D) | takeover: Layout.tsx conflict resolved, merge completed |
| `66edd760` | feat/driver-cost-ux (`111bc2f7`, wave B) | clean auto-merge |
| `7807d823` | feat/cost-ux-accounting (`da4842bf`, wave C) | 5 conflicts resolved |
| `f5823f92` | ghostty/cost-doc-final (`2a64156f`) | 12 conflicts resolved + migrations registered |

## 2. Collision decisions (per plan §3 matrix)

- **F1 OPS lot-cost scope — Ghostty G3 wins.** Wave A's `assertOpsLotCostPolicy`
  intermediate and wave C's hollowed `assertOpsExpenseAssignment` are superseded
  by G3's end state: per-person/per-lot grant deleted, only DRIVER keeps
  trip-assignment scope, `GET /expenses/write-scope` replaced by
  `GET /expenses/cont-claimants`. Consequences accepted per the plan: wave A's
  rewritten truck-scope test and wave C's `ops-expense-open-scope.test.ts` are
  deleted (their coverage lives in Ghostty's
  `ops-expense-cont-claimants-route.test.ts`, 144 lines). Wave C's
  `ops-expenses.service.ts` / `photo-authz.service.ts` (still at main's state,
  calling the name C kept) were taken with C's merge for internal consistency,
  then superseded by G3's versions at the Ghostty merge.
- **F2 Driver cost form — Ghostty G2 wins** (U3 default). G2's drafts-table +
  backend batch endpoint (one Idempotency-Key, all-or-nothing txn) + shared
  `ExpenseEvidenceFields` + shared `receiptStillNeeded()` photo rule replace
  wave B's frontend-only rework. Wave B's `components/costs/LotCostForm` had
  zero remaining references after the swap and was removed (preserved in branch
  history on `origin/feat/driver-cost-ux`). B's
  `testplan/2026-10-14-driver-cost-ux-redesign.md` (DCUX-01…05) is kept as the
  QA script for the G2 form. B's css hunks on `ShipmentCostEntryForm.css` were
  also dropped in favor of G2's, to avoid dead classes.
- **F3 PENDING tạm ứng — Ghostty G5 wins** (only implementation; wave A never
  committed CPB-03). Note a follow-up gap: `AdminAdvancesPage` has no PENDING
  tab; the status is counted in `Tất cả` and the Record is type-complete (see
  §5 fixes) but PENDING approval UX beyond the routes/tests Ghostty built is
  not present.
- **F4 Hoàn ứng settle — Ghostty G6 wins** (settle action + `refund_settled_*`
  columns + AccountingDebitClosePage). Wave A's CPB-04 and wave C's TC-05 never
  committed code.
- **F5 Accountant batch/continuous entry — Ghostty G4** (no competitor).
- **F6 Bill-digit search — ONE service module, TWO ruled semantics.**
  `deposit-bill-suggestions.service.ts` (wave D) was folded into Ghostty's
  `bill-book-search.service.ts`: `searchBillBook` (flexible 1–4 digit substring,
  phơi phiếu "Cược" field, Card 20261005) and `findBillSuggestions` (strict
  last-4 `right()` match + existing-tracker warning + ad-hoc customer fallback,
  deposit-tracker add-flow, owner ruling 2026-10-14) now live side by side with
  a comment forbidding their collapse. Rewiring D's modal to Ghostty's endpoint
  was rejected: it would silently change owner-ruled last-4 semantics and
  delete the tracker-count warning — exactly the "unique wave feature" the
  owner ordered preserved. U4 remains open for the owner only if they want a
  single semantic; none was silently chosen.
- **F10 Hero — wired set wins; Ghostty's orphan PNG dropped** (U5 default).
  `frontend/public/brand/logistics-hero-van.png` was referenced nowhere; the
  hero branch's responsive `<picture>` set was already merged (`94f4fee3`).
- **Wave D extras kept whole**: timesheet module (schema/routes/service/grid,
  casbin `timesheet` resource, nav), hoàn-cược tracker add-flow. The mid-merge
  Layout.tsx conflict was resolved per the owner's "keep BOTH nav layouts":
  qa2-008's derived-label structure (no `label:` props) with wave D's
  timesheet/timesheet-reconciliation entries adapted into it (ADMIN/MANAGER hr:
  grid only; ACCOUNTANT hr: reconciliation board; DISPATCHER: grid under
  dispatch-planning).

## 3. Drizzle migration registration (the "3 unregistered" — reality: 5 + missing snapshots)

Ghostty's commit message said "3 migrations need drizzle registration". The
committed reality: **five** SQL files
(`20261014090000_reconciliation_refund_settled`,
`20261014090000_trip_deposit_reference`, `20261014104501_clear_driver_cost_payer`,
`20261014111723_nullable_ops_expense_paid_by`,
`20261014120000_driver_cost_evidence_kind`) **with journal entries already
appended (idx 141–145) but with NO snapshot files**. Wave D's
`20261014103000_driver_timesheet` (idx 141 on its lineage) also had a journal
entry and no snapshot.

What was done:

1. **Journal merge**: wave D keeps idx 141; Ghostty's five follow as 142–146
   under their original tags (filenames unchanged). The repo's
   `journal-invariants` guard requires non-decreasing `when`, so the five
   appended entries carry registration timestamps (2026-10-15,
   1792000001…5s) rather than their authored 2026-10-14 times — append-only
   law respected (no entry reordered or renumbered;
   `guard-journal-append-only.mjs` passes).
2. **Snapshots built by staged `drizzle-kit generate`** (scratch out-dir,
   schema states walked in journal order: main+timesheet → +refund cols →
   +deposit cols → +paid_by nullable → +evidence_kind). Each stage's generated
   SQL was diffed against the corresponding hand-written file — semantically
   identical in every case (cosmetic constraint-name differences only).
   Snapshots installed as `meta/<tag>_snapshot.json` for the five schema
   migrations. `clear_driver_cost_payer` is data-only and deliberately has no
   snapshot (same precedent as idx 140 `…_backfill`).
3. **Validation**:
   - Chain: timesheet→139's id→…→evidence_kind, every prevId resolves.
   - Staged final check: generating against the full merged schema reports
     **"No schema changes, nothing to migrate"** — the chain head equals the
     schema.
   - `DATABASE_URL=…ss-prod-db npx drizzle-kit migrate`: exit 0; all six new
     entries applied; columns/tables verified (trips.deposit_*, evidence_kind,
     refund_settled_*, paid_by nullable, driver_timesheet_months/days;
     payer_kind NULL everywhere on a fresh DB).
   - **Fresh-database proof**: brand-new DB migrated 0→147 entries cleanly.

Known pre-existing limitations (documented, deliberately not fixed here):

- `npx drizzle-kit generate` **on the full history** fails on a September
  parent-snapshot collision (5 files around `20260923143417`…`20260924115231`
  point at a colliding parent id) plus historical short-named snapshot files
  that the current drizzle-kit no longer resolves by full tag. This predates
  the merge (present on main) and is why both wave D and Ghostty hand-wrote
  their SQL + journal entries; my snapshots restore a resolvable tail chain.
  Fixing the September collision means rewriting snapshot id history — history
  surgery out of this merge's scope. The staged scratch technique above is the
  workaround if a future migration must be generated.
- The shared dev DB (`ss-prod-db`, `silversea`) carries 24 driver cost rows
  with `payer_kind` set — inserted by fleet agents' stale-code QA runs after
  the wipe had already run. Not a migration defect; fresh DBs are clean.

## 4. Merge-breakage repairs (Ghostty's batch shipped with zero gate runs)

- `shared` `ExpenseAccountingCreate` now requires `shipmentId` (lot-level
  expenses, tripId nullable): four pre-existing backend test files updated to
  pass the fixture lot's id (`expense-accounting-source`, ×2 sites + shared
  `input`; `expense-cash-remediation`; `phoi-phieu-chiho-trip-source`).
- Phơi phiếu dialogs gained a required `shipmentId` prop: 16 test render sites
  updated across `PhoiPhieuDialogs.test.tsx`, `PhoiPhieuTienDuongDialog.test.tsx`,
  `PhoiPhieuChiHoDialog.test.tsx`.
- `AdminAdvancesPage`: status count maps extended with the new PENDING key.
- `timesheet.service.ts`: unused destructure `d` (lint).
- Frontend testExpectations brought up to date with merged behavior:
  deposit-tracker create payloads now include `shipmentId: null`;
  `bill-suggestions__empty` renamed `__no-match` (typeahead no-match message —
  the shared record-table css contract forbids bespoke `loading|empty` styling
  and was false-positiving); copy-appointment label now `'Ngày giờ đóng trả *'`
  (stale since qa1-007's CREATE-set asterisk ruling — pre-existing on this
  branch, not merge-caused); Layout.test matrices gained the timesheet nav
  entries (4 role matrices, accountant reachable-path list, hr section lists).
- `@tingting/shared` had to be built (`pnpm --dir shared build`) before
  backend tests — workspace dist was absent in this fresh worktree.

## 5. Gates

See `qa/2026-10-15_integration-merge_*` logs. Summary recorded in the merge
report; all six §5 gates run on the final tree.

## 6. Coverage honesty (AGENTS.md §9)

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| Migrations registered + migrate runs them + schema parity | DB/API VERIFIED | fresh-DB 0→147 apply, structure psql checks, staged no-diff generate | UI never driven; `drizzle-kit generate` on full history still blocked by pre-existing Sept collision |
| All five branches merged, conflicts resolved per matrix | CODE-READ ONLY (resolution) + compile/test gates | merge commits `290b7c09`…`f5823f92`, tsc/tests | No UI drive of any changed screen in this session |
| Gates green | automated | `qa/2026-10-15_integration-merge_*` | role-sweep/mobile widths not driven; deploy intentionally not run |

**No deploy was performed** — readiness reported; `make demo` / `make deploy`
stay with the owner.
