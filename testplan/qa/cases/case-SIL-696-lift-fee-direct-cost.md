# Case SIL-696 — Phí nâng đã duyệt không vào chi phí trực tiếp chuyến (chỉ trạm được tính)

- **Case ID:** SIL-696 (board id 808)
- **Reported:** 2026-11-06, QA report 06/11 item 4 ("Waiting on Frank"); liên quan SIL-682 (màn duyệt đã PASS).
- **Surface:** backend trip direct-cost rebuild từ chi phí lái xe đã đối chiếu — `expense-trip-cost.service.ts` `reconciledDriverCosts()` (`extra` filter). FE không đổi.

## Root cause
`reconciledDriverCosts` chỉ cộng vào `extra` các row `costGroup === 'DRIVER_ROAD'` hoặc `customerChargeAmount === 0`. Row LIFT_FEE/DROP_FEE (nâng/hạ) của lái xe mang `costGroup = 'DRIVER_SHIPMENT'` và khi có thu khách (`customerChargeAmount > 0`) thì bị loại khỏi `extra` — tiền nâng đã ĐỐI CHIẾU/APPROVED không bao giờ chạm `totalCost` của chuyến (branch toll có nhánh riêng nên vé cầu đường vẫn vào). Trip expense liên kết (syncExpenseBillingSource) cố tình nằm ngoài `computeTripTotals` (receivable/debit-note data) → khoản nâng RƠI khỏi mọi kênh chi phí trực tiếp. Test cũ `expense-trip-cost.test.ts` pin đúng luật bug ("recoverable pass-through is separate" → `extra: 0`).

## Reproduction
1. Lô mới + chuyến xe nhà IN_TRANSIT; lái xe ghi 2 khoản: Phí nâng (LIFT_FEE) 175.000₫ (thu khách > 0), Vé cầu đường (TOLL) 135.000₫.
2. Kế toán "Tích duyệt" cả 2 trên hộp thoại Chi tiết tiền đường (SIL-682) → `refreshExpenseTripCosts` chạy.
3. Trước fix: `totalCost` chỉ tăng theo toll; phí nâng 175.000₫ mất (màn duyệt tổng 310.000₫, chi phí trực tiếp 135.000₫).
4. Sau fix: `extra` nhận cả LIFT_FEE/DROP_FEE (kể cả khi thu khách > 0) → chi phí trực tiếp = 310.000₫ khớp màn duyệt.

## Expected
- Mọi khoản chi phí lái xe đã đối chiếu (nâng, hạ, trạm,…) vào chi phí trực tiếp chuyến; tổng khớp màn duyệt. Thu khách vẫn là dữ liệu thu/khách hàng, không triệt tiêu phía chi.
- Signed/negative-row luật giữ nguyên (`sumExcludingNegative`); toll giữ nhánh riêng thay estimate.

## Status
FIXED on fix/sil-cost. Unit: `backend/src/tests/unit/expense-trip-cost.test.ts` cập nhật pin mới.
