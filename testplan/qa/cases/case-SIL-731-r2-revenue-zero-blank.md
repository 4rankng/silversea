# Case SIL-731 r2 — DOANH THU lô chưa chốt hiện 0 thay vì TRỐNG (lô 100GX19033)

- **Case ID:** SIL-731 r2 (board id 851); QA verdict Muse 07/11 build b293f3cf.
- **Surface:** `/shipments-debit` cột DOANH THU (L1 wire `receivableTotal`, BE `shipment-debit-summary.service`).

## Reproduction
1. Lô **100GX19033** (shipment id 121): FCL EXPORT, **0 chuyến**, freight snapshot là dummy chưa định giá (table 0/terms 0/total 0 — đã bị carve-out SIL-731 r1 bỏ qua), `ops_expense_entries` có 1 dòng `amount=120000, customer_charge_amount=0`.
2. Mở `/shipments-debit` (Kế toán/CUS): DOANH THU của lô hiển thị **'0'** kèm tooltip 'Phát sinh nhưng tổng bằng 0'.

## Root cause
`hasAnyRevenue` armed từ `opsCharge.known` (charge khách **đã nhập, giá trị 0**) → rollup cộng các thành phần chưa xác định bằng `?? 0` → fabricate receivable 0. Trái luật 24/10: DOANH THU chỉ hiện 0 khi **đã tính = 0** (D02) hoặc lô ghép; doanh thu chưa chốt phải ô TRỐNG.

## Expected
- Lô với thành phần doanh thu duy nhất là số 0 đã nhập (PS 0 / charge 0) + freight chưa traced + không có dòng doanh thu → DOANH THU **TRỐNG**.
- Freight traced = 0 (hoặc dòng doanh thu thật, tổng 0) → vẫn hiện '0' (zero tính toán là một giá trị — D02).
- Lô ops charge khác 0, freight chưa traced → vẫn hiện số đó (không đổi).

## Fix
`backend/src/services/debit-receivable-arming.ts` (`receivableDetermined`) — arming bỏ qua side-amount bằng 0; pin: `backend/src/tests/unit/shipment-debit-summary-receivable-arming.test.ts`.
