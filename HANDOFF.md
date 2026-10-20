# HANDOFF — 2026-10-20 — fb061-fb014 residuals: FB-061 stale alarm + FB-014 quick-tab assignment law

Controller: agent, worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-fb061-fb014`,
branch `fix-fb061-fb014` (off `main` = `70b5c0a7`). Updated 2026-10-20.

**Status**: DONE — committed + pushed to origin.

- **FB-061 (201026112400, R24 B6)** NOT REPRODUCED on staging **70b5c0a7**:
  Kiểm soát phơi phiếu wire 58 rows + DOM scan = 0 hits của bộ chữ ký card
  (KHO-SEAM/STG VERIFY/BL-QAKE/E2E-/51K-PROBE/Test Driver/99T-99999/QA0915);
  invoice-tracking 0 rows. Fix `285e20e8` đã nằm trong 8bfa2ac7 (build QA
  khai) nên không phải stale-build — là stale/earlier-DATA alarm; không
  fabricate fix (precedent 63a3dfc4). Evidence: qa/2026-10-20-fb061-fb014/.
- **FB-014 (201026112500, R24 B2)** REPRODUCED + FIXED: tab "Chưa gán xe" trên
  /dispatch-detail list dòng ĐÃ điều (trip 143 CREATED, BIỂN XANH, lệnh đã
  phát, plate đang chờ "CUS sẽ bổ sung") vì split chỉ đọc planned plate
  string; cộng(class) lỗi legacy `trips.status` = 'CANCELLED' (double-L,
  trips/11) lọt qua join `<> 'CANCELED'` và hydrate thành phát-lệnh. Fix: owner
  mới `dispatch-detail-plan-assignment-sql.ts` — ASSIGNED = plate set OR live
  trip; UNASSIGNED = complement; live trip = `not in ('CANCELED','CANCELLED')`
  + chưa xóa mềm. Ba điểm tiêu thụ dùng chung: tab predicate, 2 nửa chip
  count (partition invariant giữ nguyên), trips left-join.

**Gates**: BE tsc 0 · BE unit 326/326 (pin mới
`dispatch-detail-assignment-sql.test.ts` 4/4) · FE tsgo -b 0 · FE scoped
vitest detailed-plan 384/384 (36 files) · root lint 0.
`qa/2026-10-20-fb061-fb014/gates.log`.

**Local rung-3 proof** (dev DB :5441, build dev, dieuvan): DB census 985
fulfillments đúng shape lỗi; sau fix UNASSIGNED 1265 / ASSIGNED 203 =
total 1468 (partition đúng), tab Chưa gán xe 0 dòng assigned-looking, Dòng
pending-plate (fulfillment 65076, plate '' + trip 81965 DISPATCHED) nằm đúng
tab Đã gán xe. Screenshots + DOM + driver log trong qa/2026-10-20-fb061-fb014/.

**Stack note**: backend tsx watch :3002 + vite :7175 chạy background từ
worktree này (log /tmp/ss-backend-fb061.log, /tmp/ss-frontend-fb061.log); DB
dùng container ss-prod-db :5441 / ss-prod-redis :6391 có sẵn. KHÔNG đụng
container. Terminals `ss-backend`/`ss-frontend` cũ (worktree
fix-regressions-1020b) đã chết, chưa dọn.

**Files owned by task**: backend/src/services/dispatch-planning-detail-plan-read.service.ts,
backend/src/services/dispatch-detail-plan-assignment-sql.ts (mới),
backend/src/tests/unit/dispatch-detail-assignment-sql.test.ts (mới),
testplan/2026-10-20-fb061-fb014-residuals.md, testplan/qa/scripts/2026-10-20-fb061-fb014-*.mjs,
qa/2026-10-20-fb061-fb014/ (force-tracked).

**Not covered**: staging re-drive của fix (cần deploy staging ≥ commit này —
R24 re-check phải chạy trên build mới); /dispatch (master plan) đọc theo path
khác, không thuộc surface card; FB-061 không tái lập được snapshot data 11:24
của QA — verdict dựa build + data hiện tại sạch.
