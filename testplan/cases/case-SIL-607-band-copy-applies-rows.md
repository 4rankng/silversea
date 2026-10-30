# case-SIL-607 (retest) — band Copy PHẢI ghi shared datetime vào các container rows

- **Board:** SIL-607 (id 710) — điểm dedupe đã pass; Copy HỎNG là defect còn lại.
- **QA fail (retest 30/10, build fad9bdf6, comment 3061):** band "Ngày giờ đóng trả
  cho tất cả cont" filled 29/10/2026 08:00 → bấm "Copy giờ hẹn đóng trả" → toast
  "Đã copy giờ hẹn 08:00 29/10/2026" nhưng datetime inputs các container TRỐNG
  (verify cả dòng có và không có số cont) → submit vẫn lỗi
  "Container 1: chọn ngày giờ đóng/trả."
- **QA ruling 15:10:** CUS-03 = Copy PHẢI ghi shared datetime để MỌI row thỏa
  điều kiện per-container — override comment cũ "band clipboard only, copy-all
  retired": nút Copy đang sống phải ghi thật.

## Root cause

Nút Copy của band (`csc-bulk-appointment__copy`, CopyCodeButton) chỉ ghi OS
clipboard (FB-009) + toast — không đụng model. Nút ghi thật duy nhất là
"Copy giờ hẹn xuống cont trống" ở section Thông tin hàng, copy từ ROW 1 (không
phải từ band) — QA bấm nhầm/đúng nút band đều không thấy rows nhận giá trị.

## Fix

`applyBulkAppointmentToRows()` — onCopied của band Copy ghi
`bulkAppointment` vào MỌI row còn thiếu lịch (emptyAppointmentKeys);
rows đã có lịch riêng giữ nguyên (luật set-row pin sẵn). Toast báo số row ghi:
"Đã copy ngày giờ đóng trả sang N container chưa có lịch". Clipboard copy giữ
nguyên làm kênh phụ.

## Expected (sau fix — DOM pin)

1. Band filled → click "Copy giờ hẹn đóng trả" → MỌI container input có
   ngày/giờ của band (cả dòng có và không có số cont).
2. Toast "Đã copy ngày giờ đóng trả sang N container chưa có lịch".
3. Submit: summary KHÔNG còn "chọn ngày giờ đóng/trả" ở bất kỳ đâu.
4. View mode: nút vẫn disabled, không ghi.

## Regression guards

- `ShipmentCreateWorkspace.copy-appointment.test.tsx` — "band Copy writes the
  shared datetime into every unscheduled row and clears the submit appointment
  error (QA 710)" + test SIL-511 (typing một mình vẫn không ghi).
- `ShipmentCreateWorkspace.sil607-appointment-error.test.tsx` — dedupe +
  copy-down luật cũ giữ nguyên.
