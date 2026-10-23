# Case QA-2026-10-23-FB145 — CUS Tách nhóm gộp cước: lô thành viên không hoàn lại cước sau khi tách

Card 231026163927 (QA R39 residual). Surface: Chi phí - Quyết toán → dòng lô
trong rev group → [Tách nhóm] (`UnmergeRevGroupAction` → POST
/api/shipments/lcl/unmerge-group, dimension REV).

## Root cause (2 nửa)

1. Tiền hiển thị 0₫ tồn dư: `restoreRevPreMergeMoney` với lô chưa từng có giá
   (không snapshot trước ghép) ghi snapshot cited-0 "chờ định giá lại" — nhưng
   ĐỌC (shipment-debit-summary) lấy số 0 đó làm CƯỚC VẬN TẢI (AUTO) thay vì
   "Chưa xác định" (null). Kênh trip (restateRevLeaverMoney stamp 0₫ chờ định
   giá) mắc cùng luật.
2. Loại xe nhóm còn sót: `dissolveGroupMembershipPatch` chỉ clear
   revGroupId/revGroupOrder, giữ `revVehicleClassId` của nhóm trên lô — combobox
   "Loại xe tính cước thu khách" còn giá trị nhóm sau khi tách (vi phạm
   acceptance "loại xe của nhóm gộp cũng phải được gỡ khỏi các lô" — FB-145
   thắng ruling C-1 cho flow Tách nhóm CẢ NHÓM; survivor của unmerge-theo-lô
   giữ luật C-1 như cũ).

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| FB145-R1 | Gộp 2 lô (R39B2-LCL01+02), để cước Lô 1 auto (không có giá bảng) → Tách nhóm → reload | Cả 2 lô: CƯỚC VẬN TẢI (AUTO) = "Chưa xác định" (null) — KHÔNG BAO GIỜ hiển thị 0₫ stale; TỔNG PHẢI THU KHÁCH null khi không có khoản khác |
| FB145-R2 | Lô từng có giá riêng trước ghép → tách nhóm | Cước revert đúng giá trước ghép (snapshot re-materialize — luật hiện có) |
| FB145-R3 | Combobox loại xe sau tách | Trống cả 2 lô (revVehicleClassId cleared); CUS chọn lại loại xe từng lô |
| FB145-R4 | FE transition | Ngay sau khi tách: invalidate + skeleton (h-4 w-16) ở cell cước tới khi dữ liệu mới về — không render 0₫ stale |
| FB145-R5 | Toast | "Đã tách nhóm cước thành công" + nút [Hoàn tác] sống ~6.5s; bấm Hoàn tác → re-merge đúng thứ tự thành viên + loại xe nhóm (response trả vehicleClassId) + refresh lại |
| FB145-R6 | Unmerge-theo-lô (Hủy ghép 1 lô) | Luật FB-095 giữ nguyên: survivor giữ loại xe (C-1), leaver 0₫ chờ định giá hiển thị "Chưa xác định" |
| FB145-R7 | BE unit test | Pin: unmerge REV clears revVehicleClassId; read-rule map citation "chờ định giá lại" → null; response vehicleClassId |

## Verify
- `qa/2026-10-24-gomhang-r39/` — Playwright trước/sau + SQL rev fields.
