# FB-095: LCL — Edge case an toàn: hủy ghép/xóa Lô chính
**Nguồn:** DEV SPEC §II.4 Ràng buộc an toàn — **phụ thuộc FB-092/093**
**Ưu tiên:** P0
- Trong nhóm ghép (Thu hoặc Trả): nếu Hủy ghép / Xóa Lô 1 (đang giữ 100% tiền) → hệ thống TỰ ĐỘNG chuyển quyền Lô chính + 100% tiền sang Lô 2, không được để cước rơi về 0₫
- Áp dụng cả cost_group (trả ĐV) lẫn rev_group (thu khách); audit log thay đổi
