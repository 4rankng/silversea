# Case SIL-697 — e-POD nút Hoàn thành chuyến nộp nháp thiếu file rồi fail hoàn thành

- **Case ID:** SIL-697 (board id 809); owner decision Frank 06/11 trong comment ticket.
- **Reported:** 2026-11-06, QA report 06/11 item 5; staging eca2730a, chuyến 359, pod submission 8 SUBMITTED thiếu SIGNED_DELIVERY_NOTE.
- **Surface:** BE `trip-pod.service.ts` `submitPod` (route `/api/driver/me/fulfillments/:id/pod/:submissionId/submit`) + FE `DriverTripPodPage` / `DriverTripDetailPage` hoàn thành flow + copy màn e-POD.

## Root cause
Card 261022213755a (22/10) cho nộp e-POD không cần đủ file và complete chỉ gate milestone. Nút HOÀN THÀNH CHUYẾN nộp nháp DRAFT thiếu file → submission SUBMITTED bị khóa (không thể bổ sung file) → hoàn thành fail (screenshot QA: "Ngày hoàn thành không thể trước ngày khởi hành" sau khi nộp nháp 1/2 file). Owner 06/11: kiểm đủ CẢ 2 loại bằng chứng TRƯỚC khi nộp; thiếu → chặn trước với thông báo rõ cần file nào.

## Reproduction
1. Chuyến IN_TRANSIT, e-POD DRAFT chỉ có Phiếu bãi / phiếu hạ (1/2 file).
2. Bấm HOÀN THÀNH CHUYẾN.
3. Trước fix: submit nháp thành công ("Đã lưu chứng từ giao hàng"), submission khóa, hoàn thành fail.
4. Sau fix: chặn TRƯỚC khi nộp — toast liệt kê loại còn thiếu ("Biên bản giao nhận có ký nhận"), không có lệnh submit nào đi ra API; đủ 2 file → nộp + hoàn thành thành công.

## Expected
- Thiếu 1/2 loại → không nộp nháp, thông báo rõ tên loại còn thiếu (FE toast + BE submit 409 cùng luật).
- Đủ 2 loại → nộp + hoàn thành thành công như cũ.
- BE complete giữ gate milestone (ngoài scope ticket); TC9 unlock flow hoàn thành qua DRAFT ĐỦ file vẫn giữ nguyên.

## Status
FIXED on fix/sil-cost. Unit: `DriverTripPodPage.test.tsx`, `DriverTripDetailPage.test.tsx` pin luật mới.
