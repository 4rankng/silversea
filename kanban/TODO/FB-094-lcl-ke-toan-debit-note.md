# FB-094: LCL — Kế toán chốt debit + Xuất Debit Note
**Nguồn:** DEV SPEC §II.4 — **phụ thuộc FB-090/092/093**
**Ưu tiên:** P1
- Lưới đối soát: THÔNG SỐ CONTAINER "Lẻ · Thu: 5T / Trả: 10T (Ghép cùng Bill...)"; PHÂN XE 2 dòng + badge cam "Báo khách (Ảo): BKS" nếu khác thực tế
- PHẢI THU theo nhóm rev_group; PHẢI TRẢ theo nhóm cost_group
- Xuất Debit Note: BKS BẮT BUỘC lấy billing_truck_no (tuyệt đối không in BKS thực); loại xe theo loại tính cước thu; tiền theo nhóm + ghi chú ghép. Lọc nhà xe (phải trả) dùng BKS thực + cước trả ĐV
