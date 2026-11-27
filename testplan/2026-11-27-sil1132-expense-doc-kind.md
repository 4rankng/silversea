# SIL-1132 — form chi phí lái xe thiếu ô Hóa đơn / Phiếu thu

Case ID: SIL-1132-R1..R3 (QA report 27/11 — form "Thêm chi phí" trên
`/my-trips/:id` + dòng chi phí đã lưu).

**Ticket:** SIL-1132. Form "Thêm chi phí" chỉ có Tên chi phí + Số tiền + ảnh
biên lai; KB Ch.10 §10.6.2 (SIL-271) quy định bỏ cột Người chi, bỏ Số/Ngày
hóa đơn, THÊM 2 ô Hóa đơn / Phiếu thu. Dòng chi phí đã lưu chỉ hiện nhãn
"Phiếu thu" cố định; nút "Xem / bổ sung chứng từ" chỉ cho thêm ảnh — không
có chỗ khai/đính kèm Hóa đơn.
**Owner (implement):** frontend `components/trip/ShipmentCostEntryForm.*`,
`features/driver/useDriverExpenseEntry.ts`, `components/trip/DriverSavedExpenseProofs.tsx`,
`features/expense-accounting/ExpenseProofs.tsx` (+ backend tối thiểu nếu thiếu
endpoint đính kèm chứng từ theo loại).
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per AGENTS.md §6
**KB:** Ch.10 §10.6.2 (SIL-271): bỏ cột Người chi, bỏ Số/Ngày hóa đơn, thêm 2
ô Hóa đơn / Phiếu thu.

---

## Root cause (verified in source)

Card 141026230700/SIL-759 gỡ hẳn tick chọn loại chứng từ ("no tick exists") —
`evidenceKind` chỉ suy từ catalog; dòng lưu chỉ hiện nhãn tĩnh; surface
`ExpenseProofs` chỉ upload ảnh, không khai/đính kèm theo loại chứng từ.

## Case SIL-1132-R1 — form có ô chọn Hóa đơn / Phiếu thu

- **Given** mở form "Thêm chi phí" trên chi tiết chuyến (390px).
- **When** chọn loại chứng từ rồi lưu.
- **Then** 2 ô Hóa đơn / Phiếu thu hiện trên form (mặc định theo catalog),
  lựa chọn ghi vào `evidenceKind` của body tạo; không có cột Người chi, không
  có cặp Số/Ngày hóa đơn; không cắt chữ ở 390px.

## Case SIL-1132-R2 — dòng đã lưu hiện đúng nhãn loại chứng từ

- **Given** dòng chi phí đã lưu (INVOICE / RECEIPT / chưa phân loại).
- **When** xem dòng.
- **Then** nhãn trung thực: "Hóa đơn" (INVOICE), "Phiếu thu" (RECEIPT),
  "Chưa phân loại chứng từ" (null) — không nhãn "Phiếu thu" cố định.

## Case SIL-1132-R3 — đính kèm đúng loại chứng từ trên dòng đã lưu

- **Given** dòng đã lưu + nút "Xem / bổ sung chứng từ".
- **When** khai/đính kèm chứng từ.
- **Then** surface cho khai loại (Hóa đơn / Phiếu thu) và đính kèm đúng loại
  đó — không chỉ ảnh ẩn danh.
