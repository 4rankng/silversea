# FB-094 — LCL Kế toán chốt debit + Xuất Debit Note

Nguồn: kanban/TODO/FB-094-lcl-ke-toan-debit-note.md (DEV SPEC §II.4), phụ thuộc
FB-090/092/093. Ngày: 2026-10-15.

## Phạm vi

- Backend: Luật BKS tuyệt đối của Debit Note — `buildTripRenderData` ưu tiên
  `billing_truck_no` (xe ảo) trước mọi BKS thực (trucks.licensePlate,
  externalPlateNumber); wire `billingTruckNo` qua các đường render
  (draft, export-shared, source-change). Board đối soát:
  `getAccountingDebitBoard` trả `lcl` facts (label Thu/Trả theo loại xe tính
  cước, 2 BKS, "Ghép cùng Bill X").
- Frontend: AccountingDebitClosePage — ô THÔNG SỐ CONTAINER của dòng Lẻ hiện
  "Lẻ · Thu: 5T / Trả: 10T (Ghép cùng Bill X)"; ô PHÂN XE 2 dòng BKS + badge
  cam "Báo khách (Ảo)" khi billing ≠ actual.
- PHẢI THU theo nhóm rev_group / PHẢI TRẢ theo nhóm cost_group: tiền của
  Lô 2..N đã bằng 0₫ từ lệnh ghép (FB-092/093) nên các cột tiền board/debit
  đọc đúng theo nhóm mà không cần tính lại; cước trả ĐV (cuocTraDv) tổng hợp
  theo BKS thực của nhóm.

## Case hồi quy

### FB094-01 — Debit Note in BKS báo khách
1. `buildTripRenderData` với truckPlate + externalPlateNumber +
   billingTruckNo khác nhau → truckPlate = billingTruckNo.
2. billingTruckNo null → giữ precedence cũ (trucks.licensePlate → external).

### FB094-01b — Debit Note loại xe theo loại tính cước thu
1. `vehicleTypeLabel`: candidate có revVehicleClassName/Code (nhóm thu) →
   in tên lớp (fallback mã), không in 'LCL' hay đơn vị cont.
2. Không có lớp thu → giữ nhãn cũ ('LCL' khi có packageCount).

### FB094-02 — board dòng Lẻ
1. Lô Lẻ thuộc nhóm (thu 5T / trả 10T, member Bill X): ô THÔNG SỐ CONTAINER
   hiện đúng label + "(Ghép cùng Bill X)".
2. PHÂN XE: BKS thực + badge cam "Báo khách (Ảo): {BKS}" chỉ khi khác nhau;
   BKS trùng nhau → không badge.
3. Dòng FCL giữ nguyên container list + phanXe cũ.

### FB094-03 — tiền theo nhóm (ngầm)
1. Nhóm cost 3 lô: cước trả ĐV của lô chính giữ 100%, thành viên 0₫ →
   board/debit tổng PHẢI TRẢ đúng một lần.
2. Tương tự PHẢI THU với rev_group.

## Giới hạn ghi nhận

- "Lọc nhà xe (phải trả)": board chưa có filter nhà xe riêng; BKS thực + cước
  trả ĐV đã ride từng dòng (`lcl.actualTruckNo`, `tra.cuocTraDv`) nên một
  filter sau này đọc được ngay — không dựng UI filter mới trong vé này.
- UI DRIVEN trên trình duyệt thật: chưa chạy (xem bảng coverage trong báo cáo).

## Gate

- backend: tsc + lcl-grouping.test.ts (9 case) + accounting-debit-close +
  billing tests hiện có.
- frontend: tsc -b + vitest board columns + full suite.
