# FB-014 standing — click lô trên Điều vận phải mở Kế hoạch Chi tiết (không chỉ quick-view) — 2026-10-20

Card: **201026112500** (FB-014, dieuvan) — QA R26 Batch 2 standing repro verbatim:
*"Ở màn Điều vận: CLICK VÀO 1 LÔ (row lot) chỉ mở QUICK-VIEW (popup xem nhanh),
trong khi kỳ vọng (ticket FB-014 gốc): phải mở/navigate được tới MÀN ĐIỀU PHỐI
CHI TIẾT (dispatch detail) để thao tác đủ."*

Ticket lineage: FB-014 R17 batch 2 (QA_TESTED/131026231930) was fixed under the
"tab Chưa gán xe" reading in `d4d686d6` — that fix is valid for its surface but
was NOT the ticket's expected behavior. This is the click-through reading,
confirmed verbatim by QA's R26 re-report. Original ticket text lives on the
AgentsRoom board (not in-repo); per brief step 4, the R26 verbatim expectation
IS the accepted contract: **row-lô click → /dispatch-detail**, quick-view stays
on its own affordance.

## Case ID

`FB-014-ROW-CLICK` — see Reproduction / Expected below.

## Reproduction (BEFORE, rung 3, local build @ main lineage)

dieuvan → `/dispatch` (Kế hoạch Tổng quát) → 20 lot rows:

1. Click the lot's detail affordance ('Chi tiết' trigger) → the quick-view
   drawer "Chi tiết container" opens; URL stays `/dispatch`.
   Evidence: `qa/2026-10-20-fb014-quickview/before_ui-02-click-lot-quickview.png`,
   `before_dom-02-click-lot-quickview.txt`.
2. Click the row body (plain cell) → nothing; no navigation.
   Evidence: `before_ui-03-click-row-body.png`, driver log
   `before_ui-driver.log` (`navigatedToDispatchDetail: false`).

Expected: clicking the lot reaches **/dispatch-detail** (Kế hoạch Chi tiết)
scoped to that lot so the dispatcher can assign plates/carriers per container.

## Fix

- `frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx` — the lot row
  becomes the open trigger when the parent wires `onOpenDispatchDetail`
  (pointer + Enter/Space on the focused row, UserTable convention). Every
  control inside keeps its own behavior: the 'Chi tiết' quick-view trigger, the
  allocation action cell, notes editor/trigger, LCL checkbox, selects.
- `frontend/src/pages/MasterPlanPage.tsx` — row click navigates to
  `/dispatch-detail?q=<Số Bill | Số Booking | shipment code>&date=<day>`.
  The scope rides the board's own quick search (`q` matches bill/booking/code —
  never an internal id, §2 display-key rule); the day is the master plan's
  single-day view when active, else the lot's first appointment localDate, else
  expectedDeliveryDate. No Bill/Booking → shipment code (the placeholder label
  is display copy, never a search key).
- `frontend/src/features/dispatch/detailed-plan/useDispatchDetailPlan.ts` — the
  deep link seeds initial filters ONCE: `q` always; `date` replaces the
  topbar-month bounds when present (a lot outside the topbar month stays
  visible). Unparseable `date` is ignored; afterwards the filter bar owns state.
- Quick-view (DispatchContainerDetailDrawer) unchanged on its own 'Chi tiết'
  trigger — the popup xem nhanh keeps its place per the brief.

## Verification

- Pins: `MasterPlanGrid.row-detail-navigation.fb014.test.tsx` (6 — plain-cell
  click navigates; quick-view trigger never does; allocation cell and note
  trigger keep their behavior; Enter/Space keyboard; inert without the prop),
  `MasterPlanPage.test.tsx` FB-014 describe (2 — URL shape with appointment day
  and the no-Bill shipment-code fallback),
  `useDispatchDetailPlan.test.tsx` FB-014 describe (4 — q+date seeding drops
  month bounds; q alone keeps them; unparseable date ignored; no-param default).
- AFTER drive (rung 3, local fixed build, dieuvan):
  `qa/2026-10-20-fb014-quickview/after_ui-01-row-click-dispatch-detail.png`
  (the 20/08 lot row click lands on /dispatch-detail?date=2026-08-20 — the
  day's Kế hoạch Chi tiết board, 6 dispatchable rows, URL + wire
  `dispatch-detail-plan-rows?...&date=2026-08-20`), `after_dom-01-dispatch-detail.txt`,
  `after_ui-driver.log`; the q scope separately pinned by
  `after-driver-run.q-scope.log` (row with Booking → URL
  `/dispatch-detail?q=BOOK-inv-lyguf5-8`, wire carries
  `q=BOOK-inv-lyguf5-8&dateFrom=2026-10-01&dateTo=2026-10-31` — the lot has no
  containers yet, so the correctly-scoped board is empty by data),
  `after_ui-02-quickview-still-on-trigger.png` (quick-view kept on trigger).
- BEFORE evidence: `before_ui-0{1,2,3}*.png`, `before_dom-*.txt`,
  `before_ui-driver.log`, `before-driver-run.log`.

## Gates

FE `npx tsgo -b` 0 · FE scoped vitest 690/690 (76 files: dispatch suite +
dispatch pages) · full FE suite 5302/5302 (the 2 initial failures were
`numeric-identity.styles.test.ts` reading `dist/assets` in this fresh worktree
— green after `make build`, no code involved) · root lint 0 · `make build`
succeeds — `qa/2026-10-20-fb014-quickview/gates.log`, `vitest-scoped.log`.
No backend/shared files touched.

## Not covered

- The shipped build re-drive on staging (needs the next staging deploy ≥ this
  commit; R27 re-check must run on it).
- Non-dispatcher roles on /dispatch (route is dispatch-only; ADMIN/MANAGER see
  the same grid but were not driven).
- Mobile width of the new row affordance (row click works on touch via click
  event; visual sweep not in this card's scope).
