# R31 — kẹp blocked-by-capacity + số âm ô tiền (cards 211026152138 / 211026213838)

LOCAL verify-first UI drive (FE :7185 / BE :3012 of this worktree, shared dev DB
`ss-prod-db`). Driver: `node qa/scripts/2026-10-22-r31-kep-am-ui.mjs` — final
run: **ALL GREEN (32 PASS, 0 FAIL)**.

## Card 211026152138 — Kẹp không còn block khi xe chưa khai tải trọng

Setup: fresh lot `BK-R31KEP-*` with two 20' conts, issued onto a tractor whose
moóc was created `type: null` → both trips carry `vehicle_capacity_kg = NULL`
(asserted in-run).

- `ui-01…04-*.png` — dispatch-detail grid → "Ghép chuyến" → Kẹp + partner →
  submit. Result: **no "Thiếu thông tin tải trọng xe" block**; the amber soft
  advisory renders ("Xe chưa khai tải trọng trong danh mục — … Điều vận chịu
  trách nhiệm kiểm tra tải trước khi chạy.") with the "Xong" ack.
- DB side effect: `trip_pairs` row `ACTIVE|KEP` over the two new trips; both
  trips `active_trip_pair_id` linked (in-run psql asserts, logged in
  `ui-driver.log`).
- Pre-fix behavior (repro): the same flow 422'd `MISSING_CAPACITY`.

## Card 211026213838 — ô tiền Ops/phơi/tạm ứng reject số âm

- `ui-06-tienduong-minus-stripped.png` — kế toán "Chi tiết tiền đường": typing
  `-5000` into "Thực chi" lands as `5.000` (minus stripped on entry).
- `ui-07-ops-expense-minus-stripped.png` — Ops "Khai báo chi phí": typing
  `-123000` into "Thực chi" lands as `123.000`; save proceeds (duplicate
  heads-up confirmed where shown) → DB row `ops_expense_entries.amount =
  123000` created after run start (in-run psql assert).
- `api2` probes (in `ui-driver.log`): `POST /ops/expenses` `amount=-50000` →
  400 `Số tiền không được âm.`; `amount=0` → 400 `Số tiền không được bằng 0.`.
- Tạm ứng surfaces verified positive-only already (OpsAdvanceRequestModal,
  ExpenseCashDrawer) — no change needed.

## Not covered

- The chi-hộ dialog edit was driven via the tiền-đường dialog instead; both
  share the same unsigned grouped NumberField law (component-pinned by
  `PhoiPhieuChiHoDialog.test.tsx` / `PhoiPhieuTienDuongDialog.test.tsx`).
- Driver-app cost form stays signed by owner card 20260928_197 (out of sweep).
- Staging/prod not exercised (LOCAL-only brief).
