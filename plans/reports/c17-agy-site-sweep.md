# Card 20260925_6 — site-wide pairing sweep (c17-agy-site-sweep)

**Director**: pair/group panel nổi tách khỏi filter row ở viewport rộng — áp dụng
cho MỌI host còn lại sau khi agy#1 (card _5) giữ `ListFilterBar.css` +
`ShipmentsPage.css` (EXCLUDED khỏi scope card này, chỉ verify sau khi land).

## Per-host results

| Host                          | File                                    | Severity before | Status after | Evidence                                                                                  |
| ----------------------------- | --------------------------------------- | --------------- | ------------ | ----------------------------------------------------------------------------------------- |
| ExpenseListPage               | `frontend/src/pages/ExpenseListPage.tsx` + `.css`   | **POP-DETACH + LABEL-CLIP** (Từ+Đến = 2 cells, 2 stepped labels) | **FIXED** | `.expense-filter-bar__date-pair` grid-column: span 2 / internal 2-col grid + arrow sep  |
| ShipmentContainersPage         | `frontend/src/pages/ShipmentContainersPage.tsx` + `.css` | **POP-DETACH + LABEL-CLIP** (pair = 2 flex items, "Từ ngày vận chuyển" / "Đến ngày vận chuyển" overflowed right edge) | **FIXED** | `.shipments-detail-filters__date-pair` content-sized flex item, shared label on the shell |
| ExpenseEntryPage              | `frontend/src/pages/ExpenseEntryPage.tsx` + `.css`  | none            | **VERIFY** (QA-088 already fixed) | `.expense-validity-pair` 2-up grid present; regression guard test pinned                              |
| MasterPlanGrid                | `frontend/src/features/dispatch/master-plan/MasterPlanGrid.css` | none            | **VERIFY**    | `.master-plan-filters__date-range` 9-col grid with `.master-plan-filters__date-inputs` 3-track row + label grid-column: 1/-1                    |
| DetailedPlanGrid              | `frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css` | none            | **VERIFY**    | `.detailed-plan-filters__date-scope-controls` 3-track row (date + mode + clear); `.detailed-plan-filters__date-mode` 3-track shortcut row     |
| DispatchPlanEditorCell        | `frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css` | none            | **VERIFY**    | `.dispatch-assignment-dialog__issue-times` 2-col grid; stacks at ≤640px so inputs never clip value                                            |
| ShipmentFinancePanel          | `frontend/src/features/shipment-finance/ShipmentFinancePanel.css`         | none            | **VERIFY**    | `.shipment-finance__pair` 2-col grid (two semantic field pairs in the form); flat chrome                                      |
| DebtDetailPage / PayableDetailPage | `frontend/src/components/debt/PeriodFilter.tsx` (daisyUI shell) | none            | **VERIFY**    | `period-filter` (border-y, py-4) is one band; range inputs share one segmented grid via `daisy` flex; no elevated chrome inside            |
| DashboardPage                 | `frontend/src/pages/DashboardPage.tsx` + `.css`        | N/A             | **NO FILTER** | No date-pair filter; dashboard tiles only                                                   |
| DriverTripsPage               | `frontend/src/pages/DriverTripsPage.tsx` + `.css`     | N/A             | **NO FILTER** | Tabs only — month selector is a single input inside the cards list                       |
| FleetPage                     | `frontend/src/pages/FleetPage.tsx` + `.css`            | N/A             | **NO FILTER** | KPIs + cards only; no date pair                                                             |
| SupplierListPage              | `frontend/src/pages/SupplierListPage.tsx` + `.css`    | N/A             | **NO DATE PAIR** | Search + status tabs only; carriers/sort ride the shared `record-table` base          |
| catalogs.css / record-table.css / utilities.css | `frontend/src/styles/*.css`            | N/A             | **NO OWNED PAIR** | Shared sheets carry no filter-pair selector — pair surfaces live in host-scoped CSS |

## Quy tắc chuẩn (pinned across every host above)

1. **Pair/group = one cell in the filter grid.** A `date Từ/Đến` or a
   `dropdown-status + dropdown-category` short pair is one flex/grid cell,
   not two separate cells fighting the row for width.
2. **Same background as siblings.** No `background-color: white`,
   `box-shadow`, `border-radius`, or `border-block` on the pair shell —
   the pair rides the bar surface like every other control.
3. **Baseline ≤2px.** The pair's input row sits on the same `align-items`
   rhythm as the selects beside it (`end` on the grid bar,
   `flex-start` on the `ListFilterBar` flex row). No orphan-step
   "two-bands-tall" filter row.
4. **Label never past the cell edge.** `white-space: nowrap +
   text-overflow: ellipsis` on the shared pair label; arrow separator
   hides at narrow widths.
5. **Mobile 390 keeps both on one row** (`grid-column: 1 / -1`, internal
   2-col grid intact, arrow hidden) — never a 60+60 stacked block.

## Gates (touched)
- `vitest run` for `src/pages/{ExpenseListPage,ShipmentContainersPage,ExpenseEntryPage,DashboardPage,DebtDetailPage,SupplierListPage,DriverTripsPage,FleetPage}.{tsx,styles.test.ts}` + `src/components/{debt,ListFilterBar}` + `src/features/{dispatch/{detailed-plan,master-plan,catalogs},shipment-finance}` → **485 tests pass** (29 touched file groups + 7 new pair red-first tests).
- `tsc -b` → clean.
- Test pattern: 7 new red-first styles tests (pinned pair contract) + 4 updated existing tests (label contract on the two fixed hosts).

## Excluded (agy#1 holds)
- `frontend/src/components/ListFilterBar.css`
- `frontend/src/pages/ShipmentsPage.css`

## 1280 / 1920 / 390 visual capture: skipped (no browser QA at this rung).
The pair contract is enforced by vitest styles tests (CSS+JSX pattern
matchers) and the shared flat-chrome rules from `ListFilterBar.css`
carry over via the host already adopting the shared bar (per-card
`.shipments-detail-filters` rules). Per-host 1280/1920/390 captures
deferred to the QA rung cuối (browser QA), per the card's "KHÔNG browser QA"
ruling.
