# UI Audit 2026-11-27 — Triage Record

Source: `Silversea_Staging_Full_UI_Audit_Report_2026-11-27.docx` (12 P1 + 24 P2 across 39 views, staging `vantai.tingting.vip`).
Fixes target **HEAD**. Statuses: **FIXED** (file/step) · **NOT REPRODUCIBLE ON HEAD** (staging-build divergence, evidence) · **REJECTED WITH EVIDENCE** (standing law/PRD) · **VERIFY-ON-STAGING** (verify-first item; re-check after deploy).

Shared law applied by every fix: overlays use `var(--surface)`/tokens (never raw `#fff` — `overlay-surface.styles.test.ts`); sticky chrome uses `--surface-2` + the `--z-*` ladder; seams ride **borders** because the global flat-surface reset (`base.css` `#root .app *`) nulls every `box-shadow` and `backdrop-filter`.

## P1 (AUI)

| ID | Symptom | Status | Resolution |
|---|---|---|---|
| AUI-01 | /debt numeric columns crushed; widths keyed on nth-child break when the conditional bucket-share column hides | FIXED | `DebtListPage.tsx` + `.css`: shared `--scroll` wrap, attribute-keyed tracks on th+td (`.debt-list-table [data-label=…]`), 920px board floor, nowrap guards. `DebtListPage.styles.test.ts` pins it |
| AUI-02 | Settlements modal reads translucent mid-animation; grid pill painted over | FIXED | `Modal.tsx` A1: content entrance/exit transform-only, scrim owns the fade; `AdminAdvanceSettlementsPage.css` B2: status track `minmax(104px,120px)`, actions `minmax(150px,170px)` |
| AUI-03 | Deposit-tracker action column crushes; header unnamed | FIXED | `DepositRefundTrackerPage.tsx` sr-only header label + `data-label="Thao tác"` on cells; 148px column floor in page css |
| AUI-04 | DebitMerge picker lists repeated bare 'Số HĐ'/'Tiền'/'Thực thu' labels | FIXED (+1 rejected) | `DebitMergeGrid.tsx`: group-4 `short` qualifiers shown only in the picker (`CSHT · Số HĐ`, …); group-5 twins renamed `Thực thu (GN/PS OP TC)`. Subs-row removal **REJECTED WITH EVIDENCE**: the row carries REAL group-4 sub headers ('Phí CSHT', …) — not decorative |
| AUI-05 | (dispatch allocation modal — audit view; not named in the plan mapping) | VERIFY-ON-STAGING | Walk `/dispatch` allocation modal + `/dispatch-detail` (normal + Phát lệnh hàng loạt) after deploy; the shared modal law (A1) covers dialog translucency |
| AUI-06 | Shared dialog surface fades opacity during entrance | FIXED | A1 (`Modal.tsx`): `bareEntrance` no longer fades the overlay (the surface is its first child); one completion owner |
| AUI-07 | (audit view — not named in the plan mapping) | VERIFY-ON-STAGING | Covered by the shared A1/A2/A3 surfaces; re-check on staging |
| AUI-08 | /timesheet header cells drift off their body columns ≤1100px | FIXED | `TimesheetGridPage.css`: thead th shares the body metrics (`min-width: 44px; padding: 6px 8px`) inside the container band |
| AUI-09 | /timesheet/bao-cao metric-row labels scroll away left | FIXED | `TimesheetMonthlyReportPage.css`: `.ts-report thead th[colspan='5']` left-pin only (`position: sticky; left: 0; top: auto; z-index: 4; background: var(--surface-2)`); vertical de-pin ruling stands (no seam reintroduced); ≤1023px tablet override untouched |
| AUI-10 | /ops/fleet-tracking: sticky law tears against the app-body scrollport; rows bleed through the header | FIXED | `OpsFleetTrackingPage.css`: pane = scrollport (`overflow:auto` + `max-height: calc(100dvh - var(--topbar-h) - 120px)`); sticky thead z3 + sticky first column z2/z4 in `@container (min-width: 701px)`; opaque `--surface-2` header; border seam. `OpsFleetTrackingPage.styles.test.ts` created |
| AUI-11 | /ops/wallet: same sticky/bleed class on both wallet tables | FIXED | `OpsWalletPage.css`: same pane conversion + sticky thead + sticky RIGHT action column (border seam); scoped `.ops-wallet` so OpsAccountantTab's reuse keeps its own contract. `OpsWalletPage.styles.test.ts` created |
| AUI-12 | /shipments row-selection checkbox column clips at the left edge | NOT REPRODUCIBLE ON HEAD | The audit's split/synchronized tables and the /shipments checkbox column do not exist in HEAD (staging runs a different build). No speculative change made per instruction; re-check the staging build against its own commit |

## P2

| ID | Symptom | Status | Resolution |
|---|---|---|---|
| P2-01 | Debit-close placeholder too long; `—` fallback right-aligns | FIXED | Placeholder `'Mã lô, bill/booking, KH'`; `.debit-line--stacked` flex-column flex-start |
| P2-02 | Ghep-bo filter labels don't top-stack consistently | FIXED | `.debit-merge-filter` top-stacks (label above control) in `DebitMergeGrid.css` — grounded fix: the ghep-bo filters are the grid toolbar's own labels, not `FilterBar` items (the plan's `FilterBar search.label` anchor was stale; no speculative API added) |
| P2-03 | Phoi-phiếu money/container tokens wrap; note column too narrow | FIXED | `PhoiPhieuControlPage.css`: `td.ppc-col--money` nowrap; `.ppc-col--thongso .ppc-identity` nowrap (small sub-lines keep wrapping); Ghi chú floors 160→200px, shares re-based onto the 1678px sum, TSX map + `PCC_SPEC_BASE_SUM` follow. Styles-test pins updated. Drawer-side items: VERIFY-ON-STAGING (no shared Drawer change) |
| P2-04 | Accountant-tab Bill/Booking code wraps mid-token | FIXED | `.ops-acc td.ops-wallet__cell--bill { white-space: nowrap }` on top of the SIL-884 pair (SIL-1059 law; the 160px track admits the widest measured code). KPI 3-card grid + checkbox clip: VERIFY-ON-STAGING |
| P2-05 | Treasury NGÀY column wraps mid-date | FIXED | `.treasury-table td[data-label='Ngày'] { white-space: nowrap; min-width: 96px }` + styles-test pin. KPI label wrap: not addressed (audit's fix column names only NGÀY) — triage note |
| P2-06 | Sidebar long user name wraps to two lines | FIXED | `.sidebar-user .meta .name` one-line ellipsis. Brand subtitle ellipsis: REJECTED WITH EVIDENCE (SIL-899 one-line law). Hover-bloom: kept — SIL-892 ticketed feature |
| P2-07 | Master-plan note preview leaks a pixel of line 3 | FIXED | `.master-plan-grid__note-preview` `padding-bottom: 2px` (clamp law untouched, sil877 pins hold). Thead sticky: already present on HEAD — verified |
| P2-08 | /timesheet Sunday header reads 'T1'; header buttons sprawl | FIXED | `WEEKDAY_LABELS` 'T1'→'CN' (machinery keys on the column index — label-only); comments updated in tsx/css/tests; `.ts-page .page-header__actions .btn { padding-inline: 14px }`. Column-24 clip: VERIFY-ON-STAGING |
| P2-09 | /trips floating '· 30/11' when the code part is empty; /fleet/drivers clips at the right edge | FIXED | `tripColumns.tsx` + `TripMobileCard.tsx`: separator + date render only beside a non-empty code; `FleetDriversView.tsx` wrapped in `.fleet-drivers__scroll { overflow-x: auto }` (other catalog tabs keep sticky `overflow: visible`). Left status-strip clip: VERIFY-ON-STAGING |
| P2-10 | Ops board translucent while loading; sticky header misaligned | FIXED | Covered by A1 (no opacity animation on surfaces) + A3 (pane scrollport, opaque sticky header) |
| P2-11 | Sticky header bleed-through | FIXED | A2 (`.tt-table thead th` opaque `--surface-2`, dead backdrop-filter deleted) + A3 (ops panes) |
| P2-12 | /my-settlements count-up prints '8 phiếu phiếu' | FIXED | `suffix: ' phiếu'` removed from `ForwarderSettlementsPage.tsx` (label span already prints it). Same pattern in `ForwarderAdvancesPage.tsx:90` is out of audit scope — noted for a follow-up ticket |
| P2-13 | Driver journey bill chip wraps mid-token; paired cards misaligned | FIXED | `DriverTripsPage.css`: chip one-line ellipsis (UI-15a law kept via flex 0 1 auto + min-width 0); `.driver-journey__list` stretch + card `height: 100%` + footer `margin-top: auto` |
| P2-14 | Empty photo thumb shows an "off" glyph; sticky bars use a gradient | FIXED | `DriverTripPhotos.tsx` EmptyThumb `Camera` icon; both sticky bars (`driver-task-complete-sticky`, `driver-task-accept-sticky`) → `var(--surface-2)` + `border-top` (clearance heights untouched). e-POD button width: VERIFY-ON-STAGING (HEAD renders full-bleed) |
| P2-15 | 'Thêm dòng' form renders detached at the panel bottom; rules clamp cuts mid-glyph | FIXED | `ShipmentCostEntryForm.tsx`: the draft form mounts inside the 'Chi phí lô hàng' section; `.driver-task-rules--clamped` fade mask. e-POD button width: VERIFY-ON-STAGING |
| P2-16 | POD required chip clips; upload time orphans under the thumbnail | FIXED | `.trip-pod__required` 24→28px (mobile band already 20px); image-file li groups name + time in `.trip-pod__file-namewrap` beside the thumbnail (no-truncate name law untouched). Spacing above 'Lịch sử thay thế'/'Hoàn thành chuyến': VERIFY-ON-STAGING (gaps already 2px/12px on HEAD) |
| P2-17 | Notification titles print raw internal codes; earnings ledger cards unequal | FIXED | `NotificationsPage.tsx` renders `notification.title` through `notificationDisplayMessage`; test added (title with a code, incl. inside parentheses). `.earnings-ledger-grid` stretch default. Penalties chevron: VERIFY-ON-STAGING (vendored trigger already renders ChevronDown) |
| P2-18 | /shipments-detail sort icon orphans onto line 2; band clip >1300px; merge-toggle contrast | FIXED | A4: ledger scroll band extended to 1560px (styles-test pin updated). A5: sort label rides `.table-sort-button__label` (shared nowrap law; ledger re-targets the span). A6: `.lcl-merge-toggle--active` ink fill (accent fill failed AA) |
| P2-19 | 'Quy cách đóng gói' missing red *; duplicate 'Theo nhà máy'; trailing empty actions column | FIXED + REJECTED | Red `*`: **REJECTED WITH EVIDENCE** — PRD `docs/prd/OpsVanHanh.md` D.5 (:352) declares the field a suggestion field (SIL-846): no marker, no enforcement. Duplicate note: outer route placeholder empty when `routeFollowsFactory` (the tested `.csc-container-cell__label-note` is the only signal). Trailing column: actions col/th/td render only under `isEditMode || containersLength > 1` (editor + row + workspace wiring) |
| P2-20 | /config/routes rightmost column clips ≤1500px | FIXED | `config-page.css`: the `overflow-x: visible` override deleted — the shared `.table-scroll` lane owns the scroll again. /config/customers + /shipments/document-debt: VERIFY-ON-STAGING (both already carry scroll wrappers on HEAD) |

## Verification on HEAD (this change set)

- `npx vitest run` — Wave A (10 files), Wave B (7 files), Wave C (21 + 31 files incl. the whole `src/components/trip` tree): **all green** (489+ tests across the touched sets).
- `pnpm --dir frontend lint` — 18 findings, **identical on clean HEAD** (pre-existing baseline; zero introduced).
- `pnpm --dir frontend check:ui` — fails on `DocumentDebtPage.css:19` (raw 12.5px), **identical on clean HEAD** (pre-existing; file untouched by this change set).
- Known unrelated red: `MasterPlanGrid.test.tsx > propagates every filter control change` fails on clean HEAD too (verified via stash) — pre-existing, not addressed here.

## Re-check after deploy (staging)

1. AUI-05/AUI-07 routes: `/dispatch` allocation modal, `/dispatch-detail` (normal + Phát lệnh hàng loạt).
2. AUI-12: diff the staging build's commit against HEAD before judging /shipments.
3. VERIFY-ON-STAGING rows above (drawer items, KPI grids, e-POD width, penalties chevron, document-debt/customers scroll, ops checkbox clip, column-24, status-strip).
4. B6 seam check: `/timesheet/bao-cao` horizontal scroll must show the metric label pinned left with values sliding under the opaque box — if the old vertical seam reappears, revert the B6 rule and re-triage.

## Master report cross-map (Silversea_Staging_Master_UI_Audit_Report_2026-11-27.docx)

The master report (56 views, 15 P1 + 25 P2) audited staging build
`a8f059c0` at 23:36 SGT; remediation `7a2e50e3` deployed 23:39 SGT
(backend health buildHash verified). Mapping:

- Master AUI-01…AUI-12 ≡ this document's AUI-01…AUI-12 (same
  defects, renumbered) — FIXED in `7a2e50e3`, see the tables above.
- Master AUI-13 /penalties drawer clip — NOT REPRODUCIBLE on the fix
  build (probe 27/11: panel right-anchored 861–1440 @1440, Đóng/Hủy/
  Xác nhận visible; screenshot archived).
- Master AUI-14 (/shipments/:id/edit) and AUI-15 (/fleet/external)
  dropdown opacity + trash clip + copy overlap — NOT REPRODUCIBLE on
  the fix build (probes: `.uui-select-popover` solid
  `rgb(255,255,255)` opacity 1; trash right 1409 ≤ table right 1416;
  copy 270–294 inside STT cell 257–297, row number clear). Re-verify
  on staging after the next deploy; the audits ran on the old build.
- Master P2-21 /config/freight-rate-terms sticky header — ROOT-CAUSED
  on the fix build and FIXED in the next remediation commit: a table
  inside `.record-table-wrap--scroll` resolves `position: sticky`
  against the WRAP (overflow-x: auto promotes overflow-y to auto),
  and the negative `--sticky-thead-top` pinned the header 24px above
  the wrap's top edge where the wrap's overflow clipped it. Fix:
  scroll-wrapped record tables pin flush at the wrap top
  (`styles/record-table.css`, pinned by
  `record-table-sticky-pin.styles.test.ts`).
- Master's "already fixed on 7a2e50e3" backlog note: its Wave A/B/C
  roadmap is the fix commit this document records; the remaining
  master-roadmap items (ADMIN-role crawl, 390px/360px mobile sweep,
  820px /accounting/chot-debit re-probe) stay open in
  UI-AUDIT-CHECKLIST.md.

## Retest 28/11 — verification battery on staging build 703c66fe (live probes)

The 28/11 09:10 SGT retest reported 8 P1 + 3 P2 still open. Every item was
re-probed on the live staging bundle (703c66fe, 1440px unless noted) with
computed-style measurements and screenshots; probes were taken ≥700ms after
each interaction so no entrance animation state leaks into a reading.

| ID | Retest claim | Live-bundle probe result | Verdict |
| --- | --- | --- | --- |
| AUI-02 | Lập phiếu hoàn ứng modal translucent | `.modal__content` bg `rgb(255,255,255)` opacity 1, scrim `rgba(10,10,10,.72)`; screenshot solid | CLEAN |
| AUI-04 | ColumnPicker translucent; empty middle header row; CUS left-edge peek | Panel bg `rgb(255,255,255)` opacity 1; thead = 2 rows (subs row removed, fee qualifiers on leaf headers); 889px pane scroll — no glyph at the left edge, occlusion sweep hides straddling columns | CLEAN / FIXED |
| AUI-07 | Bộ lọc popover translucent | `.filter-dropdown__popover` bg `rgb(255,255,255)` opacity 1 z400; screenshot solid | CLEAN |
| AUI-08 | Driver dropdown translucent; calendar shift on sidebar toggle | `.uui-select-popover` bg `rgb(255,255,255)` opacity 1; ts-grid th lefts == tbody td lefts exactly (272/331/473/615/757/898/1040/1182/1324) with the track lock | CLEAN |
| AUI-12 | Row-selection checkboxes clipped; header select-all invisible | No row-selection checkbox column exists on the current build (the only checkbox is the toolbar team-toggle, fully visible at x=1194); leftmost column renders whole at x=272 | NOT APPLICABLE |
| AUI-13 | Penalties drawer clips right half | Drawer right-anchored 860–1440 @1440, 700–1280 @1280, 444–1024 @1024; Đóng hit-testable, Hủy/Xác nhận whole at every width | CLEAN |
| AUI-14 | XNK dropdown translucent; trash clipped | Options list bg `rgb(255,255,255)` opacity 1; trash button whole inside its cell (screenshot) | CLEAN |
| AUI-15 | Nhà xe dropdown translucent in Thêm xe ngoài drawer | Popover bg `rgb(255,255,255)` opacity 1 above the drawer; option list solid (screenshot) | CLEAN |
| P2-21 | Freight sticky thead cut behind topbar | Real app-body scroll: computed `top: 0px`, header flush at the wrap's top edge (133 vs 132), all 9 headers whole; the catalogue area is height-bounded so long boards scroll internally with the header pinned flush | FIXED |
| P2-07 | /dispatch headers non-sticky | Scrolled 300px: thead pins at y=56 — flush under the 56px topbar (UI-05 law, ≥1418px canvases) | FIXED |
| P2-13 | KẸP pair stretches the adjacent ĐƠN card | `align-items: start` live; the pair keeps its height, the single ĐƠN keeps its own (282 vs 313 rows measured) — no void inside any card | FIXED |

Code changes in this wave: 703c66fe (AUI-04 subs-row removal + leaf
qualifiers; P2-13 start) and 29bae59558 (service worker cache fix below).

### Root cause of the retest mismatch — retired service worker served stale builds

`/sw.js` matched nginx's 1y-immutable static rule. Browsers revalidate SW
update checks against the HTTP cache, so any session that had ever run the
retired asset-caching worker (tingting-shell-v2 era) kept it — and its cached
pre-fix bundles — alive across deploys, for up to a year. The 28/11 retest ran
in exactly such a session: the 10 PASS items were in the cached snapshot, the
11 FAIL items were fixed after it. Fresh profiles (this battery) measured the
same surfaces clean on the live bundle.

Fix (29bae59558): nginx serves `/sw.js` with `Cache-Control: no-cache`; the
registration passes `updateViaCache: 'none'`, so even an already-poisoned
profile fetches the current worker on its next load and the worker's activate
purges the retired caches. QA should hard-refresh once (or clear site data)
before the next retest round; every round after that always sees the deployed
build.

### Re-test protocol note

Probe timing matters: every surface fades in (≤220ms). Screenshots taken
mid-fade read as translucent. The battery waits ≥700ms post-interaction before
measuring; QA automation should do the same, and the SW fix removes the stale-
bundle variable entirely.

## AstraQA2 (28/11) — disposition of all 14 findings

Report: SilverSea staging QA report, 28 November 2026 (Shipment operations,
accounting and driver experience). Investigation battery: four parallel
code scouts traced every finding to file:line on HEAD; fixes landed the
same day. Disposition:

| ID | Finding | Root cause on HEAD | Disposition |
| --- | --- | --- | --- |
| 01 | Debit export blocked (₫639,200) | Lock/merge law omitted the customer-priced fuel surcharge; the cycle omitted the ops-charge side (660,000 − 20,800 = 639,200). Both sides already reconciled on HEAD (`debit-merge.service` psAuto/zone + `accounting-debit-close.service` ops-charge arming; comments cite finding 01). | FIXED — in 88418971, deployed; re-verify 1514 |
| 02 | No-invoice expense unapprovable | SIL-1097 generic evidence gate (409 + disabled Duyệt) hit PHÍ KHÔNG HÓA ĐƠN by construction. Gate removed in 88418971 (supersedes comment; qa1128-confirm-evidence-optional.test). Residual stale tooltip fixed this wave (`OpsAccountantTab.tsx`: "không bắt buộc để duyệt"). | FIXED |
| 03 | New cycle missing from picker | Close mutation didn't invalidate `DEBIT_SETTLEMENT_ROUNDS_KEY`. Fixed in 88418971 (+ just-closed đợt preselect). | FIXED — deployed |
| 04 | SHP code in save confirmation | Banner built from `shipmentCode`. Fixed in 88418971 (bill-first); residual closed this wave: `bookingRef` added to the docs wire (backend mapper + client type) and the banner now routes through `billBookingReference` — SHP-* can never surface (pin: lot-banner-reference.test). | FIXED |
| 05 | "Eligible" beside disabled button | Ready line ignored the milestone gate. Fixed in 88418971: gate reason replaces the green line beside the disabled action. | FIXED — deployed |
| 06 | Packaging marked required (9/10) | Counter included the optional Folio LCL-04 field. Fixed in 88418971 (packaging seat removed from the LCL denominator). | FIXED — deployed |
| 07 | Duplicate dialog offers, then blocks | 409 classifier treated the hard `OPS_EXPENSE_TYPE_CONFLICT` as overridable. Fixed in 88418971 (`opsDuplicateRefusalIsHard`; only [Kiểm tra lại]). | FIXED — deployed |
| 08 | Driver can't find DEM/DET | The option row didn't exist. Added in 88418971 (`CONTAINER_DEMURRAGE`, receipt-mandatory). FE pin added this wave (`driver-expense-options.test`). | FIXED |
| 09 | Zero-share secondary blocks close | The grain guard dropped the grouped secondary's cited-zero row → `tongThu` null → 400. Fixed on HEAD (`accounting-debit-close.service` + merge twin exempt REV-group notes; comment cites finding 09). | FIXED — in 88418971, deployed; re-verify the both-lots close |
| 10 | Save enabled above "the maximum" | SPEC MISMATCH — the coded ceiling is ₫999,999,999,999,999 (15 digits, card 211026213838), enforced continuously FE (`amountValidOf` → canSubmit) and BE (`parseOpsMoney`). QA's tested ₫1,000,000,000,000 is 13 digits — under the cap — so the enabled Save is the coded, tested behavior; no 12-digit cap exists in any layer (repo-wide grep). | REJECTED WITH EVIDENCE — if product wants a 12-digit ceiling, it is a one-constant change across `OpsExpenseFormModal`/`OpsExpenseEditModal`/`OpsAdvanceRequestModal`/`ops-expenses.service` + the BE cap pin |
| 11 | New driver: journey error forever | `createUserWithTx` wrote only the users row; every portal read 404'd (`NoDriverProfileError`) and payroll lists the drivers table → zero rows. FIXED this wave: create provisions a default drivers profile; update self-heals pre-existing unbound accounts on the next admin save. | FIXED |
| 12 | LCL drawer "0 container · Trọng lượng —" | The cargo band had no LCL branch. FIXED this wave: LCL lots print kiện/quy cách/trọng lượng from the workspace row and an LCL-appropriate empty note (tests rewritten: ShipmentsPage reopen-consistency fixture). | FIXED |
| 13 | Wallet keeps ₫14,320 after returns | The wallet credited settlements only when a POSTED treasuryMovement referenced the ledger entry — settlement creation never posts one, so the arm was structurally empty. FIXED this wave: wallet + sổ quỹ read the SIL-1056 authority (RECORDED `refundAmount`, signed) and converge with accounting by construction (unit case pins QA's ₫27,890/13,570 fixture → ₫0). | FIXED |
| 14 | Issuing the order zeroes customer freight | `trip-create.service` persisted a fabricated `revenue '0'` when pricing resolved MANUAL; a grouped lot's effective freight reads the trip override channel first → CƯỚC 0 on issue. FIXED this wave: MANUAL persists NULL revenue faces (money-state law "never a fabricated 0₫"); the override read stays UNSET and the board falls back to the intake snapshot. Engine-priced 0 (TABLE/TIER) still persists 0. Pin: `trip-create-manual-revenue.test`. | FIXED |

NOT implemented (design acceptance targets, tracked as design work, not
defects): the laptop-density redesigns (1366×768 shipment-entry row budget,
dispatch row-height targets, the debit-grid saved-views/pinned-columns
program, driver-expenses empty-state ≤120px). These change layout programs,
not broken behavior; they need their own design pass per the report's own
framing ("proposed targets … for the next iteration").

Incident note (report §"Unintended staging change"): unscoped confirmation
also recorded CONFIRMED for bill R3J-655-LCL2 / shipment 732 (event 1899,
08:55:42 28/11, audit 201). Excluded from acceptance evidence; staging-owner
reconciliation owed — not addressable from application code.
