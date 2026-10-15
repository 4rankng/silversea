# FB-095 — LCL an toàn tách nhóm / xóa Lô chính

Nguồn: kanban/TODO/FB-095-lcl-unmerge-safety.md (DEV SPEC §II.4 ràng buộc an
toàn), phụ thuộc FB-092/093. Ngày: 2026-10-16.

## Phạm vi

- Backend `unmergeLclLot` (POST /api/shipments/lcl/unmerge): tách MỘT lô khỏi
  nhóm của một chiều tiền (COST hoặc REV).
- Luật promote-on-unmerge: Lô 1 (giữ 100% tiền) rời nhóm ⇒ hệ thống TỰ ĐỘNG
  chuyển quyền Lô chính + 100% tiền sang lô còn lại có order nhỏ nhất
  (thành viên còn lại đánh số lại 1..M). Cước không được rơi về 0₫:
    - COST: external_freight_cost của chuyến live lô chính chuyển sang lôđược
      promote; lô tách về '0'. Lô được promote không có chuyến live mà lô chính
      còn tiền ≠ 0 ⇒ 409 từ chối tách.
    - REV: revenue chuyển sang lô được promote kèm stamp lý do "Đón cước chính
      khi tách nhóm (từ Bill X)"; lô tách về '0' với lý do "Tách nhóm —
      chuyển 100% cước cho Bill Y".
- Guard nhóm đã settle: bất kỳ thành viên nào đang khóa sổ kế toán
  (shipment_accounting_locks active) ⇒ 409, không tách được — nhóm đã chốt
  không đổi thành phần. Chuyến đã COMPLETED cũng đóng băng nhóm (đồng bộ luật
  gom hiện hành).
- Tách thành viên (order > 1): tiền đã là 0₫ từ lệnh ghép; số 0 của REV được
  re-stamp lý do "Tách khỏi nhóm ghép — chờ định giá lại".
- Nhóm còn 1 thành viên sau tách ⇒ giải tán (groupId/order clear, giữ lớp
  tính cước + BKS + tiền).
- Xóa Lô 1 (softDeleteShipment): cùng luật promote — chạy trong transaction
  xóa; lô chính không còn chuyến live (điều kiện xóa) nên không chuyển tiền,
  nhưng quyền Lô chính + số thứ tự phải theo thành viên còn lại, có audit.
- Audit: sự kiện SHIPMENT_LCL_GROUP_UNMERGED ghi dimension, groupId, lô tách,
  lô được promote (nếu có), tiền chuyển, thành phần còn lại.
- Phiên tách: tự đổi (billing BKS giữ nguyên — có thể còn thuộc chiều kia).
  UI nút "Tách" các màn CUS/dispatch: ngoài phạm vi vé này (client API
  `unmergeLclLot` chưa có caller — FE test FB-093 đã mock sẵn tên hàm).

## Case hồi quy

### FB095-01 — tách Lô 1 nhóm COST
1. 3 lô (2.4M/800K/600K) gom COST ⇒ 2.4M/0/0. Tách lot1 ⇒ lot2
   externalFreightCost = 2.4M (order 1), lot3 order 2, lot1 = '0' + rời nhóm.
2. Audit SHIPMENT_LCL_GROUP_UNMERGED trên lot1.

### FB095-02 — tách Lô 1 nhóm REV
1. 2 lô (3150K/700K + pricing lane) gom REV ⇒ 3150K/0(Ghép cùng Bill X).
   Tách lot1 ⇒ lot2 revenue = 3150K + lý do "Đón cước chính…", lot1 = '0' +
   lý do "Tách nhóm — chuyển 100% cước…", nhóm giải tán (1 thành viên).

### FB095-03 — guard nhóm đã settle
1. Lock active trên MỘT thành viên ⇒ unmerge lot bất kỳ bị 409
   (/đã chốt kế toán/), dữ liệu không đổi.

### FB095-04 — tách thành viên order > 1
1. 3 lô COST, tách lot2: không tiền đổi; lot3 → order 2; REV member exit
   re-stamp lý do mới.

### FB095-05 — promote khi không còn chuyến live giữ tiền
1. Lô chính có tiền, lô 2 không có chuyến live ⇒ 409 (tiền không được rơi 0₫).

### FB095-06 — xóa Lô 1 (softDeleteShipment)
1. Nhóm 2 lô không có chuyến live nào; xóa lot1 ⇒ lot2 còn lại ungrouped
   (giải tán), không headless; audit ghi nhận.

## Gate

- backend: tsc + lcl-grouping.test.ts (toàn bộ) + shipment-service (delete
  path) + accounting-debit-close/billing hiện có.
- frontend: tsc -b (không đổi FE trong vé này).

## Giới hạn ghi nhận

- Khôi phục tiền gốc của thành viên khi tách (rev revenueOriginal / cost không
  có cột gốc): ngoài phạm vi — thành viên tách staying 0₫ chờ định giá lại;
  luật vé chỉ bảo vệ tiền của Lô chính không rơi 0₫.
- UI DRIVEN: chưa chạy (báo cáo coverage kèm theo).
