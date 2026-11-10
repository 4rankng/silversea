# SIL-797 — Thẻ lệnh lái xe: nhiệm vụ trên dòng riêng (KB Ch4 §4.2.2)

## Case
- ID: case-SIL-797
- Repro: /my-trips, thẻ lệnh có container (ví dụ `KFPQ3112046 [KẸP] 20'RF 12 tấn [ĐÓNG]`).
- Defect (staging dc930964, 10/11): pill nhiệm vụ `[ĐÓNG]/[TRẢ]` nằm TRONG dòng
  container (`.driver-journey-card__container`), đọc như dữ liệu container.
  Lô lẻ không cont cũng hiển thị pill gắn theo kiểu dòng "container".

## Expected
- Nhiệm vụ viết hoa trên DÒNG RIÊNG giữa dải container và hàng cảng
  (KB Ch4 §4.2.2: "Dòng nhiệm vụ viết hoa; ghi chú dành cho lái xe ở dòng riêng").
- Nhãn cặp [KẸP]/[KẾT HỢP] vẫn riding số container (SIL-636 — luật khác, giữ nguyên).
- Em-dash fallback khi tradeDirection không biết vẫn hiển thị trên thẻ có cont;
  thẻ không cont + không hướng thì không vẽ dòng gạch chỉ.

## Regression pin
- `frontend/src/pages/DriverTripsPage.test.tsx` → `SIL-797 — task pill owns its line`
  (pill `data-testid="load-type"` phải nằm trong `p.driver-journey-card__task`,
  KHÔNG nằm trong `.driver-journey-card__container`).

## Evidence
- vitest DriverTripsPage 42/42 (41 cũ + 1 pin mới).
