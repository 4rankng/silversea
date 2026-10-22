# Case 231026000252 — Filter ngày lọt lô LCL dated (containerless LCL BỎ QUA bộ lọc ngày)

- Card: 231026000252 (ticket 261022201006b — tiếnp vụ filter ngày CUS).
- Report: lọc 23/10–23/10 vẫn hiện lot K547238574983 {cargoMode: LCL,
  transportDate: 2026-10-17} — dated containerless LCL lot rides NGOÀI
  day-triage (commit 454fab6b, lan 1 LCL-01) ⇒ BỎ QUA bộ lọc ngày hoàn toàn.
- Root cause (verified staging API, read-only): `containerDayTriageCondition`
  (`backend/src/services/cus-workspace-sql.service.ts`) arm 1 =
  `isNull(shipmentContainers.id) AND cargoMode = LCL` exempts EVERY
  containerless LCL lot row (dated or not) from `dateArms`. Undated rows were
  already covered by arm 2 (`isNull(containerTransportDateSql())`, lan 2 card
  211026180528) — arm 1's only remaining effect is the DATED bypass = leak.

## Required law (owner decision, brief 2026-10-23)

Row/lot visible under `[from,to]` ⟺ triage day `D = coalesce(appointment VN
date, EDD)` **is null** (undated = luôn hiện) OR `from ≤ D ≤ to` (dated = phải
qua filter như lô cont). Lot visible on Tổng quan ⟺ ≥1 of its rows visible on
Chi tiết under the SAME filter (LCL-01 goal = same-filter sync, kept).

## Reproduction (before fix)

1. Fixture: `POST /shipments` LCL containerless `expectedDeliveryDate =
   2026-10-17` (mirror of lot K547238574983 shape) + one LCL undated fixture.
2. Query BOTH surfaces with `searchSuffix` + `transportDateFrom=To`:
   - `GET /api/shipments/cus-workspace` (Tổng quan)
   - `GET /api/shipments/cus-workspace/containers` (Chi tiết)
3. Filter 2026-10-23..2026-10-23: dated fixture STILL appears on Chi tiết
   (day-triage arm 1) — the leak; absent on Tổng quan (asymmetry).
4. Undated fixture: visible on Chi tiết, DROPPED on Tổng quan (asymmetry).
5. Real lot K547238574983: same leak on staging (đã verify, read-only).

## Cases

- **LCLDAY-R1 (LCL dated in-range)**: filter 2026-10-17..2026-10-17 →
  dated fixture (and lot K547238574983) PRESENT on Tổng quan AND Chi tiết.
- **LCLDAY-R2 (LCL dated out-range — THE BUG)**: filter 2026-10-23..2026-10-23
  → dated fixture ABSENT (0 kết quả) on BOTH surfaces.
- **LCLDAY-R3 (LCL undated)**: undated LCL fixture PRESENT on BOTH surfaces
  under EVERY filter (23/10, 17/10, bare) — "undated = luôn hiện".
- **LCLDAY-R4 (cont dated)**: cont-dated rows keep the exact pre-fix law —
  tiepvu-filter-ui.mjs 8 cases + boundary probe 13 checks PASS unchanged.
- **LCLDAY-R5 (đồng bộ + lot thật)**: per (filter, surface) the two surfaces
  return the same fixture set; API responses trước/sau with lot K547238574983
  saved to `qa/2026-10-23-filter-lcl-day/`.

## Unit tests (per case)

- `backend/src/tests/unit/container-date-filter.test.ts` — pure behavior via
  `filterContainersByDateRange` (fallback leg models `coalesce(appt, EDD)`).
- `backend/src/tests/unit/cus-container-day-triage.test.ts` — SQL-contract pins
  (no unconditional containerless-LCL arm; null-day arm unconditional;
  dateArms intact).
- `backend/src/tests/unit/shipment-transport-date-condition.test.ts` — lot law
  pins (undated passthrough both arms; EDD arm stays gated behind "owns no
  container" — Z-leak protection of 261022201006b preserved).

## Fix locations (source-of-truth, per defect-class sweep)

1. `cus-workspace-sql.service.ts` `containerDayTriageCondition` — drop the
   unconditional containerless-LCL arm (dated → dateArms).
2. `cus-workspace-sql.service.ts` `shipmentTransportDateCondition` — null-day
   passthrough in BOTH arms (undated luôn hiện on Tổng quan + core.routes
   deliveryDate arm via list-summaries, single-source).
3. `container-date-filter.ts` `filterContainersByDateRange` — undated rows
   kept when a range is active (counts never contradict the rows they
   summarize).

## Supersession note (LCL-01 driver dated checks)

`testplan/qa/scripts/2026-10-21-lcl01-repro.mjs` R2-dated/R5/INVARIANT demand a
dated lot (EDD 2099-06-15) appear on Chi tiết's DEFAULT lens (today). Card
231026000252 req 2 ("dated = phải qua filter như lô cont" + "lọc 23/10 → 0 kết
quả") supersedes that dated expectation: dated rows are lens-bound exactly like
cont rows. LCL-01's preserved goal = rowSource keeps lot rows (card 365),
undated always visible, and same-filter parity (case doc R2 "Mở CHI TIẾT
**cùng filter**"). The undated/structural checks of that driver remain valid.

## Kết quả (điền sau fix)

- **Repro trước fix** (`testplan/qa/scripts/2026-10-23-lcl-dayfilter-repro.mjs`,
  `RUN_LABEL=before`, backend worktree :3008, DB :5441 staging mirror):
  19/27 pass — 8 FAIL đúng triệu chứng card: LCL dated 2026-10-17 LỘ trên Chi
  tiết khi lọc 23/10 (1 row, cả lot thật K547238574983), undated MẤT trên Tổng
  quan/core khi có filter, SYNC lệch ở filter 23/10 + 17/10.
  Evidence: `qa/2026-10-23-filter-lcl-day/2026-10-23_filter-lcl-day_repro-before.log`
  + `…_lot-K547238574983-before.json`.
- **Sau fix** (cùng driver, `RUN_LABEL=after`): **27/27 pass** — dated qua filter
  ở cả 3 surface (Tổng quan / Chi tiết / core master-plan), undated luôn hiện
  dưới mọi filter, SYNC đồng bộ từng filter, lot thật 0 row dưới 23/10 và có
  dưới 17/10. Evidence: `…_repro-after.log` + `…_lot-K547238574983-after.json`.
- **Unit từng case** (4 case đặt tên): pass — scoped gate
  `npx tsx --test src/services/container-date-filter.test.ts
  src/tests/unit/cus-container-day-triage.test.ts
  src/tests/unit/shipment-transport-date-condition.test.ts` = 26/26.
  (`filterContainersByDateRange` giữ undated theo luật mới — 2 pin cũ flip,
  cite card; 4 case behavioral nằm ở file colocated `container-date-filter.test.ts`
  (tiền lệ pre-ruling), SQL-contract twins nằm `backend/src/tests/unit/`.)
- **Regression bars**: `qa/scripts/2026-10-22-tiepvu-filter-ui.mjs` rerun
  (FE :7181 / API :3008) **7/7 PASS** (driver có 7 `check()` — brief nói 8 case,
  số lượng thực tế 7); boundary probe 13/13; `2026-10-21-lcl01-lan2-repro.mjs`
  5/7 — 2 FAIL còn lại đúng 1 fixture dated 2099-06-15 dưới default lens
  (R3-dated + INVARIANT), **bị requirement 2 supersede** (dated = phải qua
  filter như lô cont — xem mục Supersession note). Evidence:
  `…_tiepvu-ui-rerun.log`, `…_lcl01-lan2-rerun.log`.
- **UI rung 3 (cả 2 màn)**: `testplan/qa/scripts/2026-10-23-lcl-dayfilter-ui.mjs`
  — 17/17 PASS: dated 17/10 ABSENT trên `/shipments` + `/shipments-detail` dưới
  filter 23/10 (screenshot + DOM + scoped API request), PRESENT dưới 17/10,
  undated PRESENT dưới filter VÀ bare (Chi-tiết bare-nav vẫn apply default lens
  hôm nay → undated vẫn hiện = anchor LCL-01). Console clean, DB proof
  (transportDate identity) trong log. Screenshots `…_ui-*.png`,
  driver log `…_ui-driver.log`.
- **Gates**: lint EXIT=0 · be-tsc EXIT=0 · BE full 338/338 EXIT=0 ·
  fe tsgo/tsc EXIT=0 · boundary probe 13/13 · FE full + make build (xem log cùng thư mục).
