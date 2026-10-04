# Case QA-2026-10-04-343 — Sửa giờ ở dialog điều phối phải hiện ở cột THỜI GIAN & LỊCH TRÌNH (card 20261004_343)

- Card: 20261004_343-dispatch-time-not-propagating-to-overview (P2, khách báo "lỗi này thấy vẫn còn")
- Environment: staging vantai.tingting.vip (QA build 813a2b0d); local dev cho regression test backend
- Account: dungnv / Abc123 (Điều vận)
- mutates: 1 fixture row qua "Sửa ô điều phối" → plannedEndAt (đặt lại giờ trả hàng)

## Repro (pre-fix)
1. Đăng nhập dungnv, vào /dispatch-detail. Dòng YUANFANG — Bill EGLV790671333291 — Cont MSCU3332915 40'DC hiện "10:00 05/10/2026".
2. Mở "Sửa ô điều phối", đổi "Giờ trả hàng" thành 13:00 ngày 04/10/2026, bấm "Lưu thay đổi".
3. Dòng /dispatch-detail cập nhật đúng "13:00 04/10/2026" (kể cả sau reload).
4. Sang /dispatch (Kế hoạch Tổng quát), tìm bill EGLV790671333291: cột "THỜI GIAN & LỊCH TRÌNH" vẫn hiện GIỜ CŨ dù đã tải lại.

## Expected (post-fix)
- Cột THỜI GIAN & LỊCH TRÌNH ở /dispatch hiển thị giờ mới đã lưu, đồng bộ với /dispatch-detail (chấp nhận trễ cache vài giây — ghi nhận của user 04/10; hết stale vĩnh viễn).
- Cơ chế: effectiveAt = tripPlannedEndAt ?? fulfillmentPlannedEndAt ?? customerAppointmentAt (ưu tiên dispatch plan → intake appointment).

## Rungs
- UI DRIVEN: rung staging 04/10 trên build 813a2b0d — edit 15:45 trên MSCU3332915 → chi tiết "15:45 05/10/2026" → /dispatch cùng bill = "15:45 05/10/2026" (đồng bộ hai màn). User tự retest cùng ngày xác nhận fixed.
- TEST VERIFIED: backend CARD-343 regression trong shipment-routes.test.ts (appointmentGroups phản ánh plannedEndAt).
- DB·API VERIFIED: /api/shipments appointmentGroups + containerPortGroups trả plannedEndAt trước customerAppointmentAt.

## Status
- [x] staging rung executed (lead) — 04/10, build 813a2b0d
- [x] user retest confirmed — 04/10
