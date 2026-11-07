# SIL-694 (id 806) — Hoàn thành chuyến kẹt cổng "Ops chưa xác nhận" khi không có đường gán forwarder

- Ticket: id 806 (board SIL, high) — QA Muse re-verify build 8f29bea4: trip 380 đủ
  ảnh + e-POD vẫn 409 "Ops chưa xác nhận hoàn tất kê khai chi phí chung và toàn bộ
  container"; công tắc PUT /forwarder/me/trips/:id/expense-completion 404 với Ops
  lẫn admin vì không tìm thấy đường gán forwarder cho chuyến; Điều vận không mở
  được /trips + /trips/:id (redirect /dispatch).
- Surface: BE governed close (`POST /api/trips/:id/complete` →
  `requireTripCloseReadiness`) + shipment-level close
  (`assertShipmentDirectCloseTripReadiness`); FE App route guard /trips + nav.

## Bug

Cổng Ops đòi scope COMPLETED mà scope CHỈ ghi được qua toggle của user OPS được
gán lô (`user_shipment_links` — cùng key `assertForwarderMutableTripScope`).
Không có assignment ⇒ không ai xác nhận được ⇒ mọi chuyến không gán Ops kẹt
vĩnh viễn. /trips bị FE guard chặn DISPATCHER (ruling 2026-09-01) trong khi owner
07/11 yêu cầu Điều vận mở được trang trip.

## Expected sau thay đổi

1. Fail-open: chuyến KHÔNG có user OPS ACTIVE nào được gán (`user_shipment_links`
   × users.role='OPS' + status='ACTIVE') → cổng Ops KHÔNG chặn; đủ ảnh + e-POD +
   pod-recovered + lý do governance → complete 200 (governance APPROVED, trip
   COMPLETED).
2. CÓ gán Ops: cổng giữ nguyên 409 "Ops chưa xác nhận…" cho đến khi Ops toggle kê
   khai (general + từng container scope) — toggle 200 cho Ops; sau toggle + cơ chế
   pod-recovered → close 200.
3. Điều vận mở được /trips + /trips/:id (read-only — write vẫn gate BE); nav Điều
  vận có 'Sổ chuyến đi'.
4. e-POD gate + photo gate + POD-recovery gate giữ nguyên.

## Regression lock

- `backend/src/tests/unit/trip-close-ops-gate-fail-open.test.ts` — 3 pin (probe
  cùng key với toggle; governed close wrap; direct close wrap).
- FE: `App.dispatcher-trips-route.test.tsx` (dispatcher MỞ được /trips — supersede
  ruling 2026-09-01 theo owner 07/11) + `Layout.test.ts` matrix +1.
- Chuỗi + UI: `qa/2026-11-07-lane-f1/setup-api.mjs` (with-ops 409 → toggle 200 →
  close 200; no-ops close 200) + `ui-drive.mjs` (dispatcher /trips, /trips/:id,
  nav item).
