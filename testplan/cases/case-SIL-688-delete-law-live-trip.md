# SIL-688 (id 800) — Luật xóa lô theo ruling owner (live-trip gate, CUS+ADMIN, Điều vận hết mục menu)

- Ticket: id 800 (board SIL) — QA Muse re-verify build 8f29bea4: (a) IN_TRANSIT bị
  chặn MỌI vai 409; (b) CUS không có nút xóa ở đâu + API 403; (c) Điều vận còn
  thấy mục 'Xóa lô' click báo "Chỉ CUS hoặc Quản trị viên…". Owner ruling: xóa
  theo LIVE-TRIP GATE (như READY_FOR_DISPATCH — chưa phát lệnh từng cont thì xóa
  được), đừng chặn theo status; CUS + Admin xóa được; Điều vận (SIL-706) GỊỆT hẳn
  mục menu, không hiện mục bị chặn.
- Surface: BE delete route/service (đã đúng trên base); FE surfaces: chi tiết lô
  /shipments/:id, drawer /shipments, menu '…' /shipments-debit, menu ⋯ Kế hoạch
  Chi tiết.

## Bug

Trên base 95e2bd13 BE law đã đúng (requireRoles CUS+ADMIN + casbin bypass CUS +
softDeleteShipment chỉ chặn live trip, không status gate; list payload
`operational.deletable` theo live-trip). Lỗi còn lại là FE: DispatchDetailPlanPage
render mục 'Xóa lô' cho MỌI vai kèm banner từ chối click-time (blocked affordance).

## Expected sau thay đổi

1. FE chỉ wire `onDeleteLot` cho CUS/ADMIN → vai khác KHÔNG thấy mục 'Xóa lô' ở
   bất kỳ surface nào (không banner lỗi chết).
2. CUS thấy nút armed trên chi tiết lô (PENDING), confirm lý do bắt buộc, xóa
   thành công (soft-delete có deletedAt), toast "Đã xóa lô hàng.".
3. Lô có trip sống (CREATED/IN_TRANSIT): nút disabled kèm lý do aria "Xóa lô — Chỉ
   xóa được khi mọi container chưa phát lệnh"; API DELETE 409 cùng message cho
   admin/CUS; dispatcher 403.
4. Lô IN_TRANSIT stale (0 trip sống — fixture pin status): DELETE admin 200 — luật
   độc lập status.
5. DISPATCHED không xóa được (live-trip law).

## Regression lock

- `frontend/src/pages/DispatchDetailPlanPage.delete-lot.test.tsx` — FB095-UI-05b
  pin mới: DISPATCHER KHÔNG thấy item (không banner, không dialog); 05a admin giữ.
- Chuỗi + UI: `qa/2026-11-07-lane-f1/setup-api.mjs` (409 live-trip admin/CUS,
  403 dispatcher, 200 CUS PENDING, 200 stale IN_TRANSIT) +
  `qa/2026-11-07-lane-f1/fixture-stale-intransit.mjs` + `ui-drive.mjs` (armed CUS
  → confirm → toast → deleted; dispatcher không thấy nút/mục; live-trip disabled
  kèm lý do).
