# Lane F1 — evidence (2026-11-07)

Branch `fix/f1-693-688-694`, base `95e2bd13`. Local worktree stack: BE :3010
(this worktree) → DB :5441 silversea; FE :7190 (vite proxy). Accounts per
`testplan/testaccounts.txt` (local password Abc123): admin, ketoan (kế toán),
tiepvv (CUS), dieuvan (Điều vận), hoangnh (OPS), pvcan (tài xế, drivers.id 33).

## SIL-693 — dead-end định giá lô hoàn thành (run trBh/trAg)

Chain driver: `qa/2026-11-07-lane-f1/setup-api.mjs` (exit 0, full log
`setup-api.log`), lot 779253 / SHP-2611-00385 / bookingRef F1-693-A-trBh, trip
779197 (TRP-202611-0219) COMPLETED qua driver flow (milestones + e-POD 2 file +
complete), rồi:

| Bước | Kết quả |
|---|---|
| lock v1 (freeze chưa giá) | 201 — `shipment_cost_locks` id 99, snapshot `freightAuto` null + basis NO_RATE_KEY (DB query trong evidence này) |
| POST /shipments/debit-notes (ketoan) | **409 NO_RATE_KEY** — guard giữ nguyên, message remedy nguyên văn: "…hãy xác định giá cước thu khách trên màn hình Chi phí - Quyết toán (chọn loại xe tính cước hoặc nhập giá), khóa lại lô rồi xuất." |
| unlock (admin, reason) | 200 |
| POST /shipments/lcl/rev-class {freightRevenue: 3800000, reason} (ketoan) | **200 — channel TRIP** (trước fix: 409 "đã hoàn thành chuyến — không đổi loại xe/giá cước thu được nữa") |
| re-lock v2 | 201 — snapshot `freightAuto` = **3800000** (DB) |
| Xuất Debit Note | qua UI kế toán (ui-drive) — 201 + dòng FREIGHT 3.800.000 |

DB side-effects:
- `trip_financial_state` trip 779197: revenue `3800000`, override reason "Chọn
  giá cước thu khách — giá nhập tay (thỏa thuận với khách)", overridden_by 147
  (ketoan).
- `audit_logs` id 12347: `action rev-class-single-lot, channel TRIP,
  completedTrip: true, completedTripId 779197, completedTripReason "Định giá bù
  trên lô đã hoàn thành chuyến — remedy SIL-693", freight 3800000` — lý do +
  audit marker (SIL-693 carve-out).

Unit pins mới: `backend/src/tests/unit/lcl-completed-trip-pricing-law.test.ts`
6/6 (carve-out có mặt, merge/assign giữ luật completed, khóa-gate đứng trước
định giá, schema reason optional). Guard test cũ
`debit-note-unpriced-freight-guard.test.ts` giữ nguyên — pass (BE unit full
975/975).

## SIL-694 — cổng Ops + toggle + /trips Điều vận

Cùng driver script, trips 779198 (B, CÓ gán Ops) và 779199 (C, KHÔNG gán):

| Case | Kết quả |
|---|---|
| B: gán hoangnh (PATCH /auth/users/3 shipmentIds) | 200 |
| B: governed close (admin) TRƯỚC toggle | **409 "Ops chưa xác nhận hoàn tất kê khai chi phí chung và toàn bộ container."** — luật giữ nguyên khi CÓ Ops gán |
| B: hoangnh PUT /forwarder/me/trips/:id/expense-completion (general + container 1440) | 200/200 — toggle kê khai hoạt động cho Ops khi có gán (trước fix 404 vì không có đường gán tìm được) |
| B: pod-recovered (ketoan) + close sau toggle | **200 APPROVED, trip COMPLETED** |
| C: governed close KHÔNG gán Ops (chỉ ảnh + e-POD + pod-recovered) | **200 APPROVED — không còn kẹt cổng Ops** (trước fix: 409 dead-end) |
| Điều vận mở /trips + /trips/:id | UI DRIVEN (ui-drive): giữ nguyên route, không redirect /dispatch; nav có 'Sổ chuyến đi' |

Unit pins mới: `backend/src/tests/unit/trip-close-ops-gate-fail-open.test.ts`
3/3. FE: `App.dispatcher-trips-route.test.tsx` đổi pin (dispatcher MỞ được
/trips — supersede ruling 2026-09-01 theo owner 07/11) + `Layout.test.ts`
matrix +1 dòng; `frontend/src/components/Layout.tsx` + nav item.

Ghi chú luật: helper `tripShipmentHasActiveOpsAssignment` dùng CÙNG key
`user_shipment_links` với guard toggle (`assertForwarderMutableTripScope`) —
gate chỉ chặn khi toggle có thể tới được.

## SIL-688 — luật xóa lô

Cùng driver script + `fixture-stale-intransit.mjs`:

| Case | Kết quả |
|---|---|
| Lot E (DISPATCHED, trip sống): DELETE admin / CUS | **409 live-trip law** "…Chỉ xóa được khi mọi container chưa phát lệnh." — chặn theo trip sống, KHÔNG theo status |
| Lot E: DELETE dispatcher | **403** (SIL-706 giữ nguyên) |
| Lot D2 (PENDING): DELETE CUS | **200** soft-delete; GET sau đó 404 (đã xóa) |
| Lot F (IN_TRANSIT stale, 0 trip sống — fixture pin status): DELETE admin | **200** — luật live-trip gate độc lập trạng thái |
| UI CUS: nút Xóa lô armed → confirm lý do → toast "Đã xóa lô hàng." | ui-drive (rung 3) |
| UI Điều vận: KHÔNG còn mục 'Xóa lô' trên menu ⋯ dispatch-detail, chi tiết lô, menu quyết toán | ui-drive (rung 3) — hết banner "Chỉ CUS hoặc Quản trị viên…" |

BE law đã đúng sẵn trên base (SIL-706 landed): route requireRoles(CUS, ADMIN) +
casbin bypass [CUS] + `softDeleteShipment` chỉ chặn trip sống (không status
gate) + list payload `operational.deletable` theo live-trip. Thay đổi duy nhất:
FE `DispatchDetailPlanPage` chỉ wire `onDeleteLot` cho CUS/ADMIN (mục menu ẩn
cho vai khác, bỏ banner click-time đã chết).

## Gates (chi tiết exit code trong qa log）

- backend `npx tsc --noEmit` → 0 lỗi
- backend `pnpm test:unit` → 975/975 pass
- frontend `npx tsc -b` → 0 lỗi
- frontend vitest affected (Layout, App dispatcher route, dispatch detailed-plan
  48 files/531 tests, delete-lot, DispatchPlanCardList) → pass
- root lint + make build: chạy ở bước Wrap (xem `gates.log`)

## Residue / fixture notes

- Các lô throwaway F1-* của các run failed trước đó đã soft-delete qua API
  (cleanup.mjs + SQL fixture chỉ tác động booking_ref 'F1-%'). Một số lô có trip
  COMPLETED không xóa được theo đúng luật (779229, 779239, 779242, 779243,
  779244, 779246, 779247) — QA residue có audit trail, không đụng dữ liệu thật.
- Fulfillment staged của zombie lots đã cancel bằng fixture SQL scoped
  `booking_ref like 'F1-%'` (claim windows chặn issue).
- hoangnh giữ links: assignment PATCH thay toàn bộ shipmentIds của user —
  merge với links hiện có trước khi ghi.

## UI claims (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| 693 remedy xuất đủ freight sau định giá bù | UI DRIVEN (export + toast + board row) | ui-drive shots 693-01/02, note detail FREIGHT 3.800.000, setup-api.log | Luồng nhập giá qua editor Quyết toán (editor đã pin unit; giá nhập bằng API cùng endpoint FE gọi) |
| 694 đóng chuyến không cần forwarder | DB/API VERIFIED (governed close 200, action APPROVED) | setup-api.log | UI click 'Hoàn thành' màn trip (gate test ở route/service; nút đã pin FE role tests) |
| 694 Điều vận mở /trips + /trips/:id | UI DRIVEN | ui-drive shots 694-01/02 + log PASS lines | 390/768 sweep (visibility-only, không đổi geometry) |
| 688 Điều vận không thấy mục Xóa lô | UI DRIVEN | ui-drive shots 688-04/05 + log | 320px |
| 688 CUS xóa qua UI mọi mặt (chi tiết lô) | UI DRIVEN (chi tiết lô: armed → confirm → toast → deleted) | ui-drive shots 688-01..03 | delete thật từ drawer + menu quyết toán (cùng một BE flow + cùng component DeleteLotAction đã pin unit) |
| 688 live-trip chặn kèm lý do | UI DRIVEN (nút disabled + aria reason) | ui-drive shot 688-06 + log | READY_FOR_DISPATCH UI delete thật (BE 200 đã chứng minh ở lane trước; cùng gate) |

## Gates — FINAL

- BE tsc 0 · BE unit 975/975 · FE tsc 0 · FE vitest FULL 798 files / 6268 tests
  ALL PASS · lint 0 errors (6 warnings cũ, file khác) · make build exit 0 ·
  ui-drive PASS (exit 0). Chi tiết: `gates.log` (gồm phân tích flake run 1/2 →
  isolation proof → run 3 sạch).
