# SIL-500 — Post-create view mất 'Tạo mới lô hàng' + Điều vận cell 'Chưa phân nhà xe' không click được

Board: SIL-500 (id 562) · KH/KHĐ báo 26/10 · Branch: fix-postview-taomoi-dispatch

## TC-SIL500-A — Post-create review thiếu nút 'Tạo mới lô hàng'

- **Report (KH 26/10):** bảng kiểm chỉnh sửa sau tạo lô — hôm qua có nút 'Tạo mới lô hàng', nay mất (SIL-481 thay action pair Quay lại/Sửa).
- **Repro:** tạo lô mới (CUS) → landing /shipments/:id (view) → quan sát cụm action topline + cuối trang.
- **Trước fix:** chỉ 'Quay lại' + 'Sửa' — KH không tạo được lô tiếp theo từ review.
- **Expected:** cluster view = Quay lại (tertiary) · Sửa (secondary) · **Tạo mới lô hàng (primary, → /shipments/new)**, lặp cả 2 chỗ (topline + cuối trang, FB-108). Role ngoài SHIPMENT_INTAKE_MUTATION_ROLES (vd ACCOUNTANT deep-link) chỉ thấy Quay lại.

## TC-SIL500-B — Cell 'Chưa phân nhà xe' không click-assign được

- **Report (KHĐ 26/10):** ô 'chưa phân nhà xe' — trước click để phân xe, nay không ấn được (nút trigger inline bị bỏ trong đợt redesign grid 23/10 — 8a28c094).
- **Repro:** Điều vận → Kế hoạch làm hàng chi tiết → click text 'Chưa phân nhà xe' (hoặc tên nhà xe) trên ô Điều phối.
- **Trước fix:** không có affordance — editor chỉ mở được qua menu ⋯ → 'Sửa điều phối'.
- **Expected:** click dòng nhà xe mở dialog 'Chỉnh sửa điều phối' (khôi phục affordance cũ, cùng guard: chuyến đang chạy → 'Phân xe lại' qua reassign flow; dòng COMPLETED giữ nguyên text — không dead trigger). Menu ⋯ giữ nguyên đường thứ 2.
