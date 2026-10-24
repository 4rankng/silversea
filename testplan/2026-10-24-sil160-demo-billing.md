# SIL-160 — /demo/billing: AR khách hàng + AP nhà xe ngoài, cấn trừ UNC chi hộ (regression note)

Case ID: TC-SIL160-01 (AR tổng hợp), TC-SIL160-02 (AP công thức cấn trừ),
TC-SIL160-03 (CSV export thật), TC-SIL160-04 (kỳ filter + empty state),
TC-SIL160-05 (UI driven 1440 + tooltip hover + download).

Spec: doc_bb1b74fcfa8b §3 (Tab 3.1 / 3.2). Ticket SIL-160
(board plan.tingting.vip/tingtingsoft/SIL). Branch `demo24-billing`
(off main sau merge demo24-shell c159b614).

## Scope under test

- Tab 3.1 — AR khách hàng: chọn KH + kỳ đối soát (month picker), bảng tự
  tổng hợp chuyến (Ngày | Booking/Bill | Cont & loại | Tuyến NM–Cảng |
  Cước), hàng tổng cộng sticky, nút **Xuất Bảng Kê (CSV)** tải file thật
  từ dữ liệu đang lọc.
- Tab 3.2 — AP nhà xe ngoài: chọn vendor + kỳ, bảng Ngày | Chuyến/Cont |
  Cước phải trả | UNC công ty chi hộ (cột riêng) | Thực trả; dòng có cấn
  trừ highlight `amber-50` + tooltip công thức bù trừ.
- Logic thuần `frontend/src/demo/billing/` (aggregations + csv + format)
  tách khỏi UI để test công thức độc lập với render.

## Reproduction / expected behavior

- TC-SIL160-01 — AR theo fixture: Samsung (SAM), kỳ 2026-10 → đúng 3 chuyến
  (T-2301, T-2401, T-2414 — gộp cả xe nhà lẫn xe ngoài), tổng cước
  14.100.000 VND; CTP → 4 chuyến 14.600.000. AR không phân biệt nguồn xe:
  khách hàng phải trả cước cho mọi chuyến của mình.
- TC-SIL160-02 — AP cấn trừ: UNC chi hộ chỉ đếm phí cảng `method: 'unc'`
  (phí lái xe tiền mặt thuộc lane hoàn ứng, không vào cột này).
  Nam Hải (VND-01) 2026-10: CH-2410-14 cước 4.500.000 − UNC 4.000.000 =
  thực trả 500.000; CH-2410-15 3.600.000 − 1.250.000 = 2.350.000; totals
  8.100.000 / 5.250.000 / 2.850.000. HTD (VND-02): CH-2410-16 lift lái xe
  chi mặt (loại trừ) + drop UNC 1.850.000 → thực trả 3.050.000. Bất đẳng
  thức `thực trả = cước − UNC` giữ trên mọi dòng.
- TC-SIL160-03 — CSV: BOM UTF-8 + CRLF + field quoted; dòng totals; tên
  file `bang-ke-phai-thu_<KH>_<kỳ>.csv`; tải thật qua Blob + anchor.
- TC-SIL160-04 — Kỳ 2026-11 (không có chuyến) → empty state, tổng 0.
- TC-SIL160-05 — Trình duyệt thật 1440: hai tab, hàng amber, tooltip hover
  hiển thị công thức, file CSV tải về nội dung đúng.

## Automated coverage

- `frontend/src/demo/billing/aggregations.test.ts` (TC-01/02/04)
- `frontend/src/demo/billing/csv.test.ts` (TC-03)
- `frontend/src/demo/pages/DemoBillingPage.test.tsx` (UI contract jsdom;
  tooltip mở bằng hover được chứng minh ở driver thật — jsdom không có
  PointerEvent nên RAC tooltip không mở được trong jsdom)
- TC-05: driver `qa/2026-10-24-demo24/billing-ui-drive.mjs` + screenshots.

## Known boundaries

- Demo fixture-only, zero API; production billing ( shipments/trips thật)
  không bị đụng tới.
- Kỳ đối soát là month picker (`input type=month`); fixtures chỉ có
  2026-10 — các kỳ khác hiện empty state (đúng logic, không phải lỗi).
- Cột UNC chi hộ gộp mọi phí `method: 'unc'` bất kể uncStatus (kỳ đối soát
  cuối kỳ: pending lẫn paid đều sẽ được UNC). Nếu owner muốn chỉ đếm
  `paid`, đổi tại `uncVndOfTrip` — một hàm duy nhất.
