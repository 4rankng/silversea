# SIL-599 (ticket 699) — /debt: tách bạch "tuổi nợ" (aging band) và "quá hạn hợp đồng" (KPI), sửa text sai ngữ nghĩa

Ngày: 2026-10-30 · Ticket SIL-599 (board id 699) · QA Glint
Quyết định pattern: **A** (webchat gemini 30/10 — "không thể đánh tráo bản chất
kế toán… Tách biệt rõ hai khái niệm"; Pattern B gộp mọi nhãn về "tuổi nợ" sẽ
mất tín hiệu cảnh báo nợ xấu). Đối chiếu ruling SIL-580 (29/10) R3 +
card 061026221213: aging buckets = TUỔI NỢ từ ngày ghi nhận; "quá hạn" = số
ngày quá hạn HỢP ĐỒNG (processingDueDate ?? originalDueDate ?? ngày ghi nhận,
cut >0).

## Hiện tượng (bug)

Trang `/debt` tự mâu thuẫn: tiêu đề pill "2 quá hạn", dòng khách "Nợ quá hạn /
6 ngày", nhưng các thẻ band ghi "0 ₫ · 0 KH quá hạn" và chi tiết `/debt/:id`
ghi "Còn nợ trong hạn" + "CHƯA ĐẾN HẠN" 100%. Cùng chữ "quá hạn" bị dùng cho
2 cách tính; nhãn band "QUÁ HẠN 1–30 / 31–90 / TRÊN 90 NGÀY" lại khoác lên
dữ liệu TUỔI NỢ (cắt 0–30 / 31–60 / 61–90 / trên 90 — ruling 29/10) — sai cả
khái niệm lẫn khoảng ngày. Thẻ "Trong hạn" còn nhấp nháy giá trị trung gian
(4.796.430 → 4.972.918 → 5.500.000 ₫) rồi mới chốt.

## Trường hợp kiểm (regression case)

- **C1 (nhãn band = tuổi nợ, đúng khoảng ngày):** band `/debt` và grid chi
  tiết `/debt/:id` hiển thị "TUỔI NỢ 0–30 / 31–60 / 61–90 / TRÊN 90 NGÀY"
  (không còn "CHƯA ĐẾN HẠN" / "QUÁ HẠN 1–30…" khoác lên dữ liệu tuổi).
- **C2 (một định nghĩa "quá hạn"):** "quá hạn" chỉ dùng cho KPI quá hạn hợp
  đồng (chip "N quá hạn", trạng thái "Nợ quá hạn", cột "Quá hạn N ngày"); band
  không còn phát ngôn "quá hạn" → pill tiêu đề không còn mâu thuẫn band.
  Quy tắc giải thích bằng tooltip trên CẢ 2 mặt (tuổi nợ + quá hạn hợp đồng,
  gồm fallback đến hạn tại ngày ghi nhận).
- **C3 (pill chi tiết nói sự thật):** `/debt/:id` có khoản quá hạn hợp đồng →
  pill "Còn nợ quá hạn · N ngày" (khớp danh sách); chưa đến hạn → "Còn nợ
  trong hạn"; hết nợ → "Đã thanh toán đủ".
- **C4 (số liệu band ổn định):** khi totals chưa tải xong band hiện "—"
  (pattern band /payables), KHÔNG hiện 0 ₫/count-up trung gian; khi có dữ
  liệu figure hiện GIÁ TRỊ CUỐI ngay (không animate 0 → giá trị).

## Phạm vi

- `/debt` (DebtListPage) + `/debt/:id` (DebtDetailPage) — text/label/tooltip +
  ổn định figure band. KHÔNG đổi API, số liệu, cách tính.
- KHÔNG đụng AP (`/payables`, PayableDetailPage, ap-aging): bucket AP vẫn là
  contractual due-status (cuts 0/30/90) — nhãn "CHƯA ĐẾN HẠN / QUÁ HẠN…" giữ
  nguyên cho AP (re-anchor AP cần ticket riêng — out-of-scope note SIL-580).

## Bằng chứng

- Pin mới: `DebtListPage.band.test.tsx` (C1, C2, C4), `debt-payable-aging.test.tsx`
  (C1 grid chi tiết, C3 pill), tooltip title pins.
- Webchat verdict: gemini 30/10 — chọn Pattern A (dẫn trong comment ticket).
