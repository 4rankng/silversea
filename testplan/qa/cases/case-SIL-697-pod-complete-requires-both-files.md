# Case SIL-697 — e-POD nút Hoàn thành chuyến nộp nháp thiếu file rồi fail hoàn thành

- **Case ID:** SIL-697 (board id 809); owner decision Frank 06/11 trong comment ticket.
- **Reported:** 2026-11-06, QA report 06/11 item 5; staging eca2730a, chuyến 359, pod submission 8 SUBMITTED thiếu SIGNED_DELIVERY_NOTE.
- **Surface:** BE `trip-pod.service.ts` `submitPod` (route `/api/driver/me/fulfillments/:id/pod/:submissionId/submit`) + FE `DriverTripPodPage` / `DriverTripDetailPage` hoàn thành flow + copy màn e-POD.

## Root cause
Card 261022213755a (22/10) cho nộp e-POD không cần đủ file và complete chỉ gate milestone. Nút HOÀN THÀNH CHUYẾN nộp nháp DRAFT thiếu file → submission SUBMITTED bị khóa (không thể bổ sung file) → hoàn thành fail (screenshot QA: "Ngày hoàn thành không thể trước ngày khởi hành" sau khi nộp nháp 1/2 file). Owner 06/11: kiểm đủ CẢ 2 loại bằng chứng TRƯỚC khi nộp; thiếu → chặn trước với thông báo rõ cần file nào.

## Reproduction
1. Chuyến IN_TRANSIT, e-POD DRAFT chỉ có Phiếu bãi / phiếu hạ (1/2 file).
2. Bấm HOÀN THÀNH CHUYẾN.
3. Trước fix 06/11: submit nháp thành công, submission khóa, hoàn thành fail.
4. Fix 06/11 (đã SUPERSEDED — xem bên dưới): chặn trước khi nộp, toast liệt kê loại còn thiếu.
5. **Luật hiện hành (09/11)**: thiếu file → toast mềm "Thiếu N file e-POD — nên bổ sung." → nộp/hoàn thành VẪN CHẠY; đủ file → như cũ, không toast.

## Expected (luật 09/11 — SUPERSEDES mục "Expected" 06/11 bên dưới)
- e-POD/ảnh là TÙY CHỌN trên MỌI đường (quyết định ràng buộc 22/10 card 261022213755a "0 ảnh vẫn hoàn thành chuyến" + SIL-733 ĐÃ PASS — luật mới nhất thắng theo KB).
- KHÔNG chặn hoàn thành; KHÔNG chặn nộp e-POD. FE hiện CẢNH BÁO MỀM "Thiếu N file e-POD — nên bổ sung." trước khi gửi; BE `submitPod` không còn 409 thiếu file.
- Thông báo thiếu file vẫn hiện trong chi tiết chuyến (footer Chứng từ: dòng đếm mềm + tên từng loại thiếu).
- BE complete giữ gate milestone; TC9 unlock flow hoàn thành qua DRAFT vẫn giữ nguyên.

<details><summary>Expected 06/11 (superseded 09/11)</summary>
- Thiếu 1/2 loại → không nộp nháp, thông báo rõ tên loại còn thiếu (FE toast + BE submit 409 cùng luật).
- Đủ 2 loại → nộp + hoàn thành thành công như cũ.
</details>

## Status
RE-RESOLVED 09/11 theo luật tùy chọn trên `fix/r8b-717-697-758` (base origin/main 6d7a3886): BE gate 409 gỡ (`trip-pod.service.ts submitPod`), FE warn+proceed (`DriverTripPodPage`, `podReadiness.ts`), copy tùy chọn (`TripPodSubmission`, footer `DriverTripDetailPage`). Pins: `DriverTripPodPage.test.tsx`, `TripPodSubmission.test.tsx`, `DriverTripDetailPage.test.tsx`. QA 09/11 staging c4cea6b6 đã quan sát completion 0/2 file thành công (trip 110) — đúng luật tùy chọn, không phải hồi quy.
