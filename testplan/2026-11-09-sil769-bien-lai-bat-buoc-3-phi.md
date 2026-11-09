# SIL-769 — Ảnh biên lai chỉ bắt buộc với Phí Nâng, Phí Hạ, Lưu vỏ (Lưu cont)

- **Nguồn:** ticket SIL-766..769 wave CR-006 (file 2026.11.09.Ticket.docx, Phần II Epic 1 mục 2B); REV2 `/tmp/ticket-v2.txt` Task 2B ("Ngoài Phí nâng, Phí hạ, Phí lưu cont, các chi phí khác đều KHÔNG bắt buộc chụp ảnh"); Frank 09/11/2026: "khách hàng bảo thế nào thì làm thế".
- **Map tên gọi:** "Lưu vỏ" (brief) = "Phí lưu cont" (REV2) = cùng một khoản lưu container tại bãi — trên picker lái xe là dòng **"Phí lưu bãi"** (catalog `YARD_STORAGE`); app không có dòng đặt tên "Lưu cont"/"Lưu vỏ" riêng.
- **Loại:** thay đổi luật nghiệp vụ (supersedes CP700-03 — "MỌI dòng nhóm DRIVER_SHIPMENT phải có ảnh biên lai, FE chặn + BE từ chối"; testplan `2026-10-16-card141026230700-driver-chiphi-hai-bang.md` CP700-03 và `2026-10-18-card191026100030-chiphispec-gaps.md` mục 2 ghi luật cũ, giữ nguyên làm lịch sử).
- **Trạng thái:** LAND (nhánh `fix/r9a-driver-glm`).

## Quy tắc mới

1. Ảnh biên lai CHỈ bắt buộc với 3 loại phí: **Phí Nâng** (catalog `LIFTING`), **Phí Hạ** (`LOWERING`), **Lưu vỏ** (`YARD_STORAGE` — dòng "Phí lưu bãi" trên picker lái xe).
2. Các loại phí khác (Phí vệ sinh, Phí lưu kho, Công nhân tại kho, Hàn container, Đảo vỏ, "Chi phí lô hàng khác"…) **không bắt buộc ảnh** — lưu bình thường khi không có ảnh, kể cả khi tick "Phiếu thu".
3. Khi thiếu ảnh ở 1 trong 3 khoản bắt buộc: chặn Lưu và thông báo **nêu rõ tên khoản** thiếu ảnh (`Phí nâng/Phí hạ/Phí lưu bãi phải kèm ảnh biên lai trước khi lưu.` — testid `shipment-cost-receipt-required`).
4. FE form và BE `insertDriverIncidentalCostTx` đọc chung `DRIVER_RECEIPT_REQUIRED_EXPENSE_TYPE_CODES` (shared) — hai cổng không được lệch nhau.
5. Dòng tiền đường (vé cầu đường, định mức, sửa chữa dọc đường) giữ nguyên hợp đồng ảnh tùy chọn; tick "Phiếu thu" trên dòng LOT không còn tự chặn ảnh.

## Kiểm chứng

| Case | Bước | Kết quả mong đợi |
|---|---|---|
| SIL-769-A1 | Nhập Phí Nâng / Phí Hạ / Phí lưu bãi, chưa có ảnh | Chặn Lưu, báo đúng tên khoản thiếu ảnh |
| SIL-769-A2 | Nhập một khoản khác (vd Phí vệ sinh) chưa có ảnh | Lưu được bình thường, payload không mang `receiptStorageKey` |
| SIL-769-A3 | Nhập đủ 3 khoản bắt buộc kèm ảnh | Lưu được bình thường |
| SIL-769-BE | POST `/driver/me/trips/:id/incidental-costs` dòng `YARD_STORAGE` không `receiptStorageKey` | 400 "Phí lưu bãi phải kèm ảnh biên lai trước khi lưu." |

FE pins: `ShipmentCostEntryForm.test.tsx`, `ShipmentCostEntryDraft.test.tsx`; BE pin: `backend/src/tests/sil769-driver-receipt-required-fees.test.ts`.
