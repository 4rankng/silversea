# Card FB-113 — Thứ tự trường trong popup "Chỉnh sửa chứng từ và hãng tàu"

- Card: `171026122140-fb113-chi-tiet-lo-thu-tu-chung-t.docx` (P3 trivial)
- Scope: CUS Chi tiết lô — popup/inline editor "Chỉnh sửa chứng từ và hãng tàu"
  (`frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx`,
  `mode === 'documents'`).

## Expected order (top to bottom)

1. Số Bill / Số Booking (theo Nhập/Xuất — cùng một ô chứng từ tham chiếu)
2. Số tờ khai
3. Nhập / Xuất
4. Hãng tàu

Previous (buggy) order: Nhập/Xuất → Số Booking → Hãng tàu → Số tờ khai.

## Case FB-113-01 — DOM order of the four fields

Reproduction:

1. Mở popup "Chỉnh sửa chứng từ và hãng tàu" cho một container row ở chiều
   XUẤT (ô Số Booking hiển thị).
2. Query bốn trường có nhãn: `Số Booking`, `Số tờ khai`, `Nhập / Xuất`,
   `Hãng tàu`.
3. Mỗi trường phải đứng TRƯỚC trường kế trong DOM
   (`compareDocumentPosition`), theo đúng thứ tự spec.

Expected: Booking < Tờ khai < Nhập/Xuất < Hãng tàu trong DOM order.
Pure reorder — hành vi nhập liệu, Lưu, nút copy tờ khai không đổi (giữ các
case hiện hữu của card 261013200312 / 171026180010).

## Evidence

- FE test: `frontend/src/features/shipments/detail/ShipmentContainerLedger.test.tsx`
  → `FB-113 renders the documents editor fields in the card-mandated order`.
