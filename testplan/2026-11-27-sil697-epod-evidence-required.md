# SIL-697 — e-POD: chặn nộp/ch hoàn thành khi thiếu file chứng từ (RE-OPEN owner 07:42 27/11)

Case ID: SIL-697-R1..R5 (QA report 27/11 — `/my-trips/36/pod`, build 23a8fa17, nhvuong).

**Ticket:** SIL-697 (RE-OPEN owner 07:42 27/11). Quy tắc Frank 06/11 vẫn
đứng, KB hiện tại ghi BẮT BUỘC (Ch.4 §4.2.4/§4.2.6, Ch.10 §10.4.3): ở lớp
hoàn thành, ảnh chứng từ giao nhận là **bắt buộc** — đủ bộ chứng từ của loại
lô thì nút Hoàn thành mới sáng; thiếu nhóm nào thì nút chặn lại và nói rõ
thiếu nhóm đó. Thay thế luật "SIL-697 resolved 09/11 — optional" và luật
SIL-733 "0 ảnh vẫn hoàn thành chuyến".
**Owner (implement):** frontend `lib/podReadiness.ts`, `components/trip/TripPodSubmission.tsx`,
`pages/DriverTripPodPage.tsx`, `pages/DriverTripDetailPage.tsx`.
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per AGENTS.md §6
**KB:** Ch.4 §4.2.4, §4.2.6; Ch.10 §10.4.3. Mode-aware set (SIL-1110, K3.65)
giữ nguyên: hàng lẻ (LCL) đòi Biên bản giao nhận có ký nhận; FCL giữ bộ 2
nhóm (Phiếu bãi / phiếu hạ + Biên bản giao nhận có ký nhận).

---

## Root cause (verified in source)

`lib/podReadiness.ts` + `DriverTripPodPage.handleSubmitPod/handleCompleteTrip`
chỉ cảnh báo mềm ("Thiếu N file e-POD — nên bổ sung.") rồi **vẫn nộp nháp +
hoàn thành**; badge 2 nhóm ghi "Tùy chọn"; chân trang ghi "thiếu vẫn bấm
HOÀN THÀNH CHUYẾN được". `DriverTripDetailPage.handleCompleteTrip` cũng hoàn
thành bất chấp thiếu chứng từ ("completes regardless").

## Case SIL-697-R1 — thiếu 1 trong 2 loại file → không nộp nháp + thông báo cần đủ file

- **Given** chuyến IN_TRANSIT có DRAFT e-POD chỉ có Phiếu bãi / phiếu hạ (FCL).
- **When** bấm HOÀN THÀNH CHUYẾN (hoặc NỘP CHỨNG TỪ E-POD).
- **Then** không có lời gọi submitPod/completeTrip nào; thông báo rõ
  ("Thiếu 1 file e-POD — cần bổ sung đủ trước khi nộp và hoàn thành chuyến.")
  + danh sách tên nhóm còn thiếu.

## Case SIL-697-R2 — thiếu cả 2 loại → chặn trước

- **Given** DRAFT rỗng (0 file) hoặc chưa có submission.
- **When** bấm HOÀN THÀNH CHUYẾN.
- **Then** nút chặn (disabled, tooltip/message nêu lý do); không nộp, không hoàn thành.

## Case SIL-697-R3 — đủ bộ chứng từ → nộp + hoàn thành thành công

- **Given** DRAFT có đủ 2 nhóm (FCL) hoặc đủ Biên bản (LCL).
- **When** bấm HOÀN THÀNH CHUYẾN.
- **Then** submit DRAFT trước, completeTrip sau, điều hướng về /my-trips, toast thành công.

## Case SIL-697-R4 — màn chi tiết lệnh cũng chặn (cùng defect class)

- **Given** `/my-trips/:id` IN_TRANSIT thiếu chứng từ.
- **When** bấm Hoàn tất (sticky bar).
- **Then** không completeTrip; thông báo nêu nhóm thiếu. Đủ file → confirm → nộp (nếu DRAFT đủ) + hoàn thành.

## Case SIL-697-R5 — LCL giữ luật SIL-1110 (mode-aware)

- **Given** chuyến LCL chỉ có Biên bản giao nhận có ký nhận.
- **When** kiểm gate.
- **Then** đủ (1 nhóm) → cho nộp + hoàn thành; không đòi Phiếu bãi/phiếu hạ.
