# FB-093: LCL — CUS Chi phí-Quyết toán: ghép/tách cước thu khách
**Nguồn:** DEV SPEC §II.3 — **phụ thuộc FB-090**
**Ưu tiên:** P0
- Chi tiết lô: THÔNG SỐ CONTAINER hiện "Lô lẻ | Thu: Xe 3.5T | Trả: Xe 10T"; PHÂN XE 2 dòng (Nhà xe - BKS Thực / BKS Báo khách (Ảo) click-sửa nhanh, combobox + free text)
- Quyết toán: checkbox đầu dòng + nút [Ghép cước thu khách]; validation CHỈ ghép cùng 1 khách hàng (lỗi chặn nếu khác); popup chọn loại xe tính cước + BKS ảo chung nhóm
- rev_group_id: Lô 1 = 100% CƯỚC VẬN TẢI (AUTO), Lô 2..N = 0₫ + chú thích "Ghép cước cùng Bill X"; TỔNG CHI HỘ giữ nguyên; không ghép = thu riêng từng lô
