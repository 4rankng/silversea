# Case SIL-759 — App lái xe: cấu trúc lại Chi phí lô hàng & Tiền đường

Nguồn: SIL-759 (board SIL), file 2026.11.09.Ticket.docx — Phần II Epic 1 mục 2 (CR-006, nhóm B).
Surface: `frontend/src/components/trip/ShipmentCostEntryForm.tsx` trên `/my-trips/:id` (màn Chi tiết lệnh, app lái xe).

## Reproduction (hiện trạng, staging build 7c7db25c 09/11)

1. Đăng nhập lái xe (bqhuong) → Chi tiết lệnh → khu "Chi phí lô hàng & tiền đường".
2. Khu Tiền đường chỉ có dòng tham chiếu "Chưa có định mức tiền tuyến…" / "Tiền tuyến tham chiếu…", không có số tạm tính khóa cứng.
3. Bấm [+ Thêm chi phí] (nút chung cả 2 khu): form xổ dọc cao từng trường một dòng — Loại chi phí (tab 2 nhóm), Tên khoản chi, "Thực chi (VND)", "Ngày chi *", khung "Chụp / chọn biên lai" to, Ghi chú.
4. Lái xe có thể tự kê thêm tiền đường (Vé cầu đường, Tiền đường khác, định mức) qua tab Tiền đường.

## Expected behavior (sau fix)

1. Khu Tiền đường hiển thị số tạm tính định mức do hệ thống ghi (`totalRoadAllowance`), khóa cứng chỉ xem; khi chưa có định mức hiển thị đúng trạng thái "Chưa có định mức tiền tuyến".
2. Không có nút [+ Thêm chi phí] / [+ Thêm dòng] tại khu Tiền đường; nút thêm chỉ nằm tại khu Chi phí lô hàng.
3. Ô "Ghi chú tiền đường" nằm ngay dưới số tiền đường (ghi lệch thực tế cho kế toán đối soát — lưu qua `costSubmissionNote` hiện có).
4. Bấm [+ Thêm chi phí]: chỉ dòng chi phí LÔ HÀNG, 1 hàng ngang 4 phần: (1) Tên chi phí dropdown (Phí nâng, Phí hạ, Lưu kho/bãi, Khác…); (2) "Số tiền" (không còn nhãn "Thực chi (VNĐ)"), tự định dạng phân cách nghìn; (3) icon camera nhỏ cạnh ô tiền (bắt buộc biên lai cho dòng lô — CP700-03 giữ nguyên); (4) nút Xóa dòng.
5. Không còn ô "Ngày chi" — hệ thống tự gán ngày hiện tại trên thiết bị lúc nhập (`businessDateISO()`).
6. evidenceKind dòng lô suy ra từ danh mục (INVOICED → INVOICE, còn lại RECEIPT) — không còn cặp tick Hóa đơn/Phiếu thu trên dòng nhập.
7. Dòng tiền đường đã lưu (Vé cầu đường…, ROAD_ALLOWANCE hệ thống) vẫn hiển thị trong bảng Tiền đường như trước; dòng hệ thống vẫn khóa sửa.

## Out of scope (trong ticket)

- Quy tắc "ảnh chỉ bắt buộc với Phí Nâng/Phí Hạ/Lưu vỏ" — chờ Frank quyết (KB Ch.10 §10.6.2 đang "tùy chọn").
- Backend tự tính định mức (dữ liệu điều vận/chấm công) — `totalRoadAllowance` đã có từ backend; ticket này là bố cục + luồng nhập.

## Verification

- Unit: `frontend/src/components/trip/ShipmentCostEntryForm.test.tsx`, `ShipmentCostEntryDraft.test.tsx` cập nhật theo contract mới.
- UI DRIVEN: đăng nhập bqhuong, màn Chi tiết lệnh, 390px + 768px — screenshot từng bước, DOM assertion, DB proof (trip_incidental_costs + trips.cost_submission_note), driver log.
