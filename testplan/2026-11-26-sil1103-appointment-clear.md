# SIL-1103 (id 1279) — Xóa lịch hẹn container đưa lô về 'chưa chốt lịch' (K2.128)

Case ID: TC-SIL1103-APPT-CLEAR-01
Feature: ngày giờ đóng/trả của container phải sửa VÀ xóa được như nhau; xóa hết lịch (khi lô chưa phát lệnh) đưa lô về 'chưa chốt lịch', hiển thị trống — không tự điền ngày hôm nay.

## Repro (staging vantai.tingting.vip, build trước fix)
1. Lô 1314 (bill F2K288TEST01, 'chưa chốt lịch'). Sửa: gõ 28/11/2026 10:00 vào 'Ngày giờ đóng trả' container MSKU1234565, Lưu → READY_FOR_DISPATCH.
2. Mở lại Sửa, xóa hết ngày/giờ trong ô.
3. Lưu: KHÔNG chạy — FE chặn 'Bắt buộc: 8/9', lỗi đỏ 'Container 1: chọn ngày giờ đóng/trả.'
4. API PUT /api/shipments/1314 bỏ ngày hẹn → 409 'Không thể xóa lịch hẹn cuối cùng của container khi lô đã sẵn sàng điều xe.'

Thực tế: lô đã có lịch thì không còn đường nào xóa lịch để về 'chưa chốt lịch' (cả UI lẫn API chặn).

## Nguyên nhân (3 rào)
1. FE validator `getShipmentCreateReadiness` + `requiredSlots` bắt buộc appointment cho mọi dòng FCL, kể cả khi Sửa lô (dialog Sửa tái dùng workspace tạo).
2. BE `reconcileShipmentContainersInTx` (PUT /api/shipments/:id) 409 khi FCL + xóa hết lịch + lô READY_FOR_DISPATCH.
3. BE CUS: `updateCusShipmentContainerLine` 409 cùng điều kiện; path xóa dòng container cũng 409 khiREADY mất dòng cuối có lịch.

## Kỳ vọng (KB §2.4.9 K2.128)
- Xóa được ngày giờ đóng/trả KHI KHÔNG CHUYẾN XE NÀO ĐANG CHẠY trên lô: lô về PENDING_DATE ('chưa chốt lịch'), hiển thị trống, có dòng shipment_status_history lùi READY→PENDING_DATE và cancel fulfillments ('Shipment schedule cleared') — cùng cleanup với lùi ngày cấp lô (card 091026091510 trong shipment-update.service).
- RÀO CHẮN = phụ thuộc điều xe ĐANG CHẠY (trip non-deleted, non-CANCELED — trực tiếp hoặc qua fulfillment), KHÔNG phải nhãn trạng thái: có live trip ⇒ 409 với thông báo gốc 'Không thể xóa lịch hẹn cuối cùng của container khi lô đã sẵn sàng điều xe.'; không có ⇒ xóa hợp lệ. Đây là luật nhà đã pin cho lùi ngày cấp lô (091026091510); SIL-1103 chỉ áp cùng luật cho 3 đường xóa lịch cấp container.
- Per-row guard giữ nguyên: container có chuyến (kể CREATED) chặn sửa lịch qua đúng thông báo cũ ('Container đã gắn chuyến xe…' / giá trị-aware trip guard của line edit).
- Nửa đặt lịch bằng tay không đổi (becomesReady PENDING→READY giữ nguyên).
- Handoff điều vận không bị chạm khi lùi — handoff UNSEEN cũ vẫn dùng lại khi chốt lịch lần nữa (ensureReadyShipmentHandoff không nhân bản).

## Bề mặt sửa
- BE `shipment-containers.service.ts`: helper thuần `containersLosingAppointment` (dòng nào mất lịch), guard reconcile ('Sửa thông tin lô' PUT) fence theo live trip + demote PENDING_DATE sau gate.
- BE `cus-shipment-workspace-writes.service.ts`: `updateCusShipmentContainerLine` — `clearsLastAppointment && trip != null` ⇒ 409, không trip ⇒ `becomesUnscheduled` demote + history; path XÓA DÒNG container — fence live-trip thay 409 vô điều kiện, `projectShipmentScheduleAndVersion` thêm nhánh demote (READY + hết lịch ⇒ PENDING_DATE + history + cancel fulfillments).
- FE `shipment-create-model.ts` + `ShipmentCreateTopline.progress.ts`: giờ đóng/trả bắt buộc chỉ với DÒNG MỚI (không có id lưu); dòng đã lưu được xóa trống — chip không đếm slot đó, không lỗi đỏ, payload gửi `customerAppointmentAt: null` lên reconcile PUT.

## Expected (sau khi sửa)
- Repro trên: Lưu rỗng thành công → lô 1314 về 'chưa chốt lịch', ô hiển thị trống, status history có mục lùi READY→PENDING_DATE.
- Lô có chuyến đang chạy xóa lịch → 409 thông báo gốc (cả 3 đường); FE hiện lỗi server.
- Xóa DÒNG cuối có lịch (trip-free) → lô về PENDING_DATE, rời kế hoạch điều vận như lô chưa có lịch.

## Not covered bởi hồ sơ này
- LCL `lclClosingAt` — không thuộc ticket (chỉ FCL container appointment).
- Xóa lịch một phần (2 cont xóa 1): giữ nguyên hành vi hiện tại (lô giữ READY với 1 dòng có lịch, derivedDate = sớm nhất còn lại) — ticket chỉ yêu cầu đường xóa hết lịch về 'chưa chốt lịch'.
- Bằng chứng UI DRIVEN (rung 3): verify mức API (rung 2) trên stack local; FE pin bằng unit test model/workflow/progress.
