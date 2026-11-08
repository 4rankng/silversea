# Case SIL-733 r2 — Hoàn tất lệnh vẫn bị chặn khi thiếu chứng từ (quyết định 22/10)

- **Case ID:** SIL-733 r2 (board id 853); QA verdict Muse 07/11 build b293f3cf, chuyến /my-trips/383 (Chứng từ 1/2, Ảnh 0/3).
- **Surface:** FE `DriverTripDetailPage.handleCompleteTrip` (sticky CTA 'Hoàn tất lệnh vận chuyển').

## Reproduction
1. Lái xe (bqhuong) mở chuyến IN_TRANSIT có e-POD DRAFT thiếu file (0/2 hoặc 1/2 loại bắt buộc).
2. Bấm [Hoàn tất lệnh vận chuyển] → confirm 'Hoàn tất'.
3. Trước fix: FE tự ý `submitPod` DRAFT thiếu file → BE 409 (luật SIL-697: không nộp nháp thiếu file) → toast 'Chưa đủ chứng từ giao hàng…' → chuyến vẫn 'Đang chạy'.

## Expected (quyết định 22/10 card 261022213755a, nhắc lại 07/11 — ảnh TÙY CHỌN, 0 ảnh vẫn hoàn thành)
- Hoàn tất KHÔNG bị chặn vì thiếu ảnh/ chứng từ: DRAFT thiếu file **không được nộp tự động** (giữ DRAFT mở, bổ sung file + nộp sau được — luật SIL-697 còn nguyên trên luồng nộp tường minh ở trang e-POD), `completeTrip` chạy ngay.
- DRAFT đủ 2 loại → nộp + hoàn thành như cũ (TC9).

## Fix
FE-only skip-submit-when-incomplete trong `handleCompleteTrip`; pin: `DriverTripDetailPage.test.tsx` (zero-file + half-file variants).
