# Shipped-waves QA verification on staging (2026-10-16)

Four waves merged to main and shipped to staging WITHOUT a staging QA pass,
verified here on `https://vantai.tingting.vip` (STAGING ONLY; no prod access,
no merge, no deploy). Branch `qa/shipped-waves-verify-1016` off `ae419e3d`.
Driver: `testplan/qa/scripts/shipped-waves-verify-rung.mjs` (phases:
acct | admin | dispatch | cus | cusfcl | driver), evidence `qa/1016-shipped/`.

## Build gate — substitution recorded

Step 0 required `buildHash == ae419e3d`. At 06:34Z staging served `ae419e3d`;
at 07:01Z it served `7dcdcf33` (staging was re-cut mid-run by the deploy-hold
actor; main HEAD `aa3e7ba3` carries "DEPLOY HOLD"). The gate aborted loudly.
Continued on `7dcdcf33` because `ae419e3d` is an ancestor of `7dcdcf33` and
`git diff ae419e3d..7dcdcf33` is EMPTY on every surface these waves touch
(ExpenseEntry*, InvoiceTracking*, tires, TripDetailPage, topbar.css,
DispatchPlanEditorCell.css, backend/src/seed). Every phase asserted
`buildHash == 7dcdcf33` before driving. Verdicts therefore land on the four
waves' shipped code; the delta (W1 ketoan+cham-cong FB-096..104, wave-1016c
QA records) is outside this verification's scope.

## Per-wave verdicts

| Wave | Commit | Verdict | Evidence (rung) |
|---|---|---|---|
| (a) UI-audit-wave-1 form contract | `c5f1cd3e` | **PASS 4/4** | rung 3 on all four pages |
| (b) W5 fb-regressions | `7c44a1fd` | **PASS 4/4** | FB-043/057 rung 3; FB-061 rung 1 + unit pin; FB-048 pin rung 1 + (d) spot |
| (c) kanban-wave-1016b | `a6ba72c5` | **PASS 5/5** | all five cards re-driven rung 3 (FB-083/084/085 via this run + QA2-005 search; FB-066) |
| (d) W3a-r17-verify spot | `ae419e3d` | **PASS 6/6 spot-checked** | rung 3 |

Totals: 21 TCs re-driven — 21 PASS, 0 FAIL, 0 product defects found. No fixes
required (0 fix commits; the two FAIL rows in the raw phase logs
(`qa/1016-shipped/*_log.json`) are driver bugs — a focus-persistence
measurement error on FB-057 and a select-all omission on FB-085 — corrected
in the driver and re-driven to PASS; they were never product behavior).

## TC table

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| WAVE-A-1 ExpenseEntry sections + retired `.expense-input`/`.expense-required`, rose markers, no native required | 3 | `acct_01/02-*.png`; DOM: 0 retired classes, 4 × `.ds-field__required`, 0 `[required]`, sections THÔNG TIN CHUNG/DANH MỤC/SỐ TIỀN present; 390px no overflow (`acct_log.json`) | `/expenses/:id/edit` variant not driven (same component) |
| WAVE-A-2 invoice modal 2-col→1-col ≤640px + unified UUI anatomy | 3 | `acct_03/04-*.png`; computed grid 2 tracks @1440 → 1 track @390; 25 controls, 0 raw `.input` | — |
| WAVE-A-3 TruckTiresPage "Serial lốp" rose marker | 3 | `admin_01-tires-serial-label.png`; label carries `.ds-field__required`, no plain-text asterisk node (truck 1) | trailer variant `/fleet/trailers/:id/tires` not driven (same control) |
| WAVE-A-4 TripDetail governance modal rose marker | 3 | `admin_05-trip-governance-modal.png` (trip 147 IN_TRANSIT); `.tdp-governance-asterisk` = 0, `.ds-field__required` = 1; closed via Hủy, nothing submitted | Hủy-chuyến variant modal shares the same markup (code-read) |
| FB-043 dispatch assignment band beats base rules | 3 | `dispatch_01-dispatch-band-1440.png`; 42 cells uniform 100px, plate/carrier/driver `nowrap`+`ellipsis`, plate·driver inline | ≤900px card band untouched (per contract) |
| FB-057 topbar search fluid focus | 3 | `admin_03/04-topbar-focus-*.png`; @1440 rest/focus `max-width:none` (782px), @1100 rest 360px → focus 560px | — |
| FB-061 demo seeder prod gates | 1 | HEAD code-read (`demo-seed-gate.ts` wired into seed.ts / seed-dashboard.ts / seed-demo-freight-pricing.ts) + `seed-demo-gate.test.ts` 18/18 green at HEAD | Triggering the guard needs a prod-shaped DB write — prohibited on staging; unit pin is the contract |
| FB-048 select cascade test pin | 1 | `form-control-boundaries.test.ts` green (in 49 FE pins) | see (d) spot for the rung-3 UI evidence |
| FB-066 quick-add on TripInfoCard | 3 | `admin_02-trips-new-quickadd.png`; 2 × `.tc-field-quick-add` "Thêm nhanh" on /trips/new | dialogs opened but not submitted (would create master data) |
| FB-083 "Ngày giao hàng" label | 3 | `cus_log.json` label dump: `Ngày giao hàng *`, stale label absent | — |
| FB-084 CBM optional (LCL) | 3 | `cus_02/03-*.png`; blank-CBM lot #606 created, API `cargoVolumeCbm: null`, fixture deleted (200) | — |
| FB-085 per-cont tờ khai inline + auto-copy | 3 | `cusfcl_01/02-*.png` + `cusfcl_log.json`; fixture 612 (3 × ISO-6346 QAWU*): first save `TKQAW160001` fanned out to both empty siblings; cont 2 diverged to `TKQAW160002` and persisted; final `[0001,0002,0001]`; fixture deleted (200). Guards held: BL-on-board abort, editor-heading check | explicit "Copy số tờ khai sang N cont…" button not forced (auto-copy left no empty siblings; `copyBtn:null` recorded; button path pinned by FE ledger tests + W3a `cus-fcl_04/05` rung-3 record) |
| QA2-005 shipments text search | 3 | `cus_06/07-*.png`; `?searchSuffix=SHP-2610-00156` → 1 row, identity tied via API (lot 515, bill R17B3-LE-01 displayed per house display law); diacritic "…Việt Nam" applied (suffix + 20 rows); `AB%1` never applied | — |
| FB-075 date auto-advance | 3 | `cus_05-date-autoadvance.png`; focus lands "Tháng — Ngày giao hàng" after typing 15 | — |
| FB-044 container picker position | 3 | `cus_04-container-picker-position.png`; popTop 731 ≥ trigBottom 720 | — |
| FB-035 driver money format | 3 | `driver_01-money-formatted.png`; 15000 → `15.000` in "Thực chi (VND)" (trip 79); draft dropped, nothing submitted | — |
| FB-048 payment guard (re-drive) | 3 | `acct_05/06-*.png`; Ghi nhận disabled on empty; amount 0 → banner "Số tiền không hợp lệ." + `aria-invalid` + `rgb(160,68,78)` border; cancelled, no payment written (refused by validation) | no-write probe couldn't parse the payments payload (-1/-1) — the refusal banner is the guard, recorded as caveat |
| MOBILE create-shipment 375px + desktop | 3 | `cus_08-create-mobile-375.png` (scrollWidth 375 = viewport), `cus_09-create-desktop-1440.png` | — |

## Local pins at HEAD (ae419e3d)

- FE scoped: Topbar + DetailedPlanGrid rowheights + form-control-boundaries +
  AccountingInvoiceTracking styles = 49/49; ExpenseEntryPage 7/7; wave-1016b
  pins (asterisk-contract + TripInfoCard quick-add + ShipmentsPage) = 145/145.
- BE scoped (`tsx --test`): seed-demo-gate + cus-record-search 18/18;
  shipment-intake-lcl-cargo 3/3; shared cus-shipment-workspace 18/18.
- Full `backend pnpm test` (unit+integration) was started for completeness and
  killed at the background time limit — no backend source is touched by this
  delivery, so no backend gate is owed beyond the scoped pins above.

## Hygiene

- All fixtures `QAW16*`-prefixed; every write carried an Idempotency-Key;
  three abort-path orphans (607/608/609) deleted the moment they appeared via
  the hardened driver's abort-cleanup.
- Final sweep: `GET /api/shipments?q=QAW16` → 0 (also QAW3A → 0, QAWU200 → 0).
- No master data created; container types / trucks / customers read via admin
  token as fixture setup. No "Xóa bộ lọc" clicks; no filter clears; no real
  row typed into (editor-heading guard).
- Roles: hoapt (ACCOUNTANT), admin, dungnv (DISPATCHER), tiepvv (CUS),
  bqhuong (DRIVER) per `testplan/testaccounts.txt`, Abc123.
