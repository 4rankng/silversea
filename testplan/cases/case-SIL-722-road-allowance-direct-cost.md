# SIL-722 (id 842) — Tiền đường lái xe ĐÃ DUYỆT vào tổng chi chuyến

- Ticket: SIL-722 (board SIL, id 842, tạo 07/11/2026 theo owner decision
  "yes — tính vào tổng chi chuyến", cơ hội SIL-696).
- Owner 07/11 đảo điểm "ROAD_ALLOWANCE stays out (system salary law)" mà
  commit 754efdee (SIL-696) giữ nguyên.

## Bug (kết quả thực tế trước fix)

Một dòng TIỀN ĐƯỜNG (ROAD_ALLOWANCE) của lái xe đã duyệt (expenseAccountingSources
`status='RECORDED'` + `confirmedAt IS NOT NULL` — ví dụ Trả đêm 100.000₫,
Chạy hàng quá tải 200.000₫) không phản ánh vào `trips.totalCost`:
`reconciledDriverCosts.extra` loại trừ `costType === 'ROAD_ALLOWANCE'`.
Phí nâng/hạ đã duyệt thì ĐÃ vào (SIL-696).

## Luật tránh double-count

- Tiền đường TUYẾN (`trips.totalRoadAllowance`, seed lúc tạo chuyến) đã nằm
  sẵn trong totalCost qua `computeTripTotals` nhánh OWN — KHÔNG đụng.
- Các dòng incidental ROAD_ALLOWANCE là tiền ngoài định mức (fee norms
  Trả đêm / Quay đầu / Quá tải / Đảo chuyển ICD / Chủ nhật / Lưu ca / Cont
  đặc biệt, hoặc kế toán thêm tay nhóm DRIVER_ROAD) — số RIÊNG, cộng thêm
  không trùng với totalRoadAllowance.
- TOLL giữ nhánh riêng (reconciledTollCost thay thế estimate trạm, không cộng);
  số âm vẫn bỏ qua (`sumExcludingNegative`).

## Case pin (expected sau thay đổi)

1. `reconciledDriverCosts` gồm ROAD_ALLOWANCE vào `extra`: TOLL 80.000 +
   ROAD_ALLOWANCE 200.000 + OTHER 30.000 → `{ toll: 80000, extra: 230000 }`.
2. Duyệt tiền đường 100.000₫ → `totalCost` chuyến tăng đúng 100.000₫
   (refreshExpenseTripCosts chạy tại màn duyệt — expense-accounting-write
   confirm đã gọi sẵn).
3. Negative ROAD_ALLOWANCE row → coi như không tồn tại.
4. Không đụng totalRoadAllowance/tollCost đường khác.

## Regression evidence

- `cd backend && npx tsx --test src/tests/unit/expense-trip-cost.test.ts` →
  6/6 pass (3 pin mới SIL-722, qa/2026-11-07-lane-g1/).
- API evidence thật: qa/2026-11-07-lane-g1/sil-722_api-*.log (local :3002).
