# FB-092: LCL — Kế hoạch Chi tiết Xe: gom chuyến trả ĐV + xe ảo + nhảy tiền
**Nguồn:** DEV SPEC §II.2.2 — **phụ thuộc FB-090**
**Ưu tiên:** P0
- Cột CONTAINER dòng Lẻ: 3 dòng (Lẻ · Xe 5T / 5 PALLET / 1.922 kg · 4 CBM)
- Tích nhiều lô → thanh tổng "Đang chọn N lô: Tổng X kg | Y CBM"
- Popup gán xe nhóm: (1) cost_vehicle_type dropdown trọng tải/cont; (2) actual_truck_no — Xe tải chỉ Xe ngoài, Cont cho phép nội bộ; (3) billing_truck_no (BKS ảo) auto-copy từ thực tế, combobox + free text
- cost_group_id: Lô 1 = 100% cước trả ĐV, Lô 2..N = 0₫; tag PHÂN LOẠI "Lẻ · Ghép (1/5)..."
- Cont nội bộ: tiền đường/lương chuyến chỉ tính Lô 1
