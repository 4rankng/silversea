# SIL-1227 (id 1413) — Lưu nháp mất mạng: câu tiếng Việt, hết tiếng Anh thô (regression case)

Case ID: TC-SIL-1227-01
Feature: Tạo lô hàng (/shipments/new) — "Lưu nháp" khi máy mất mạng (KB §1.4.2 K1.11 / §2.6.1 K2.161).

## Repro (QA, build 2d15ef50, 28/11)
1. tiepvv mở /shipments/new, chọn khách LONG MINH, Xuất khẩu, Số Booking.
2. Tắt mạng, bấm "Lưu nháp".

## Expected
- Toast/banner tiếng Việt rõ: "Mất kết nối, chưa lưu được. Giữ nguyên nội dung và thử lại khi có mạng." (câu offline SAVE dùng chung theo luật SIL-1035/SIL-1105 — ticket ví dụ "Chưa thể lưu — mất kết nối…" cùng nghĩa).
- Không hiện "đã lưu" giả; nội dung giữ nguyên; bật lại mạng không tự gửi (không trùng lô).

## Root cause + sửa
- Catch lưu của `use-shipment-create-workflow.ts` in `error.message` nguyên văn → TypeError mạng của trình duyệt lọt qua.
- Route qua `actionErrorMessage('lưu lô hàng', …, NETWORK_FAILURE_SAVE_MESSAGE)`: mọi TypeError mạng (Firefox/Chrome/Safari) → một câu; lý do máy chủ thật giữ nguyên văn; abort/race không toast.

## Pins
- `frontend/src/features/shipments/create/use-shipment-create-workflow.sil1227-offline.test.tsx` — 3 engine text → đúng câu + không chứa tiếng Anh máy; lý do máy chủ verbatim; update/containers không bị gọi khi create lỗi.

## Not covered
- UI DRIVEN offline thật: QA verify trên staging sau deploy (devtools offline + Lưu nháp).
