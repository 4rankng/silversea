# Card 20261005_387 — Điều phối: ghi đè rơ-moóc theo chuyến trên API phát lệnh (regression case)

Case ID: TC-20261005_387-01
Feature: "Phát lệnh cho tài xế" trong "Chỉnh sửa điều phối" (DispatchPlanEditorCell → IssueOrderFields / useIssueOrder) — chọn moóc khác moóc đang ghép của đầu kéo cho MỘT chuyến, gửi qua `POST /shipments/:id/dispatch` (`trailerId` đã có sẵn trên route schema `core.routes.ts:82` và service input).

## Quyết định thiết kế (theo audit thẻ 051026230618)
- Mặc định vẫn là moóc đang ghép của đầu kéo (`trucks.current_trailer_id`) — khi không ghi đè, body KHÔNG gửi `trailerId` (omitted, byte-compat với trước thẻ), backend tự resolve như cũ.
- Chỉ hiển thị với xe nhà (OWN): nhà xe ngoài tự mang thiết bị, backend bỏ qua `trailerId` cho EXTERNAL.
- Hiện trạng moóc đang ghép luôn hiển thị (biển số + loại) để đối chiếu; khi chọn moóc KHÁC moóc đang ghép, hiện note so sánh "Ghi đè moóc: X thay cho moóc đang ghép Y."
- 3 cổng 409 backend giữ nguyên và hiển thị nguyên văn qua dòng lỗi issue ("chưa có rơ-moóc khả dụng" / "không còn hiệu lực" / "không phù hợp với loại container") — FE không chặn trước, không tự phán.
- Quyền: điều khiển nằm trong section "Phát lệnh" vốn chỉ với ADMIN/MANAGER/DISPATCHER (route role-gate sẵn); role khác không thấy section nào cả.
- Phân xe lại (PATCH /trips/:id/reassign) CHƯA map `trailerId` (route không truyền trường này vào `reassignIssuedDispatchWriteCommand`) — mở rộng sang reassign cần sửa route backend, ngoài phạm vi thẻ này (ghi nhận named gap).

## Repro (trước khi sửa)
1. Điều vận mở "Chỉnh sửa điều phối" chuyến xe nhà đã đủ điều kiện → section "Phát lệnh cho tài xế".
2. Không có lựa chọn moóc nào; phát lệnh luôn dùng moóc ghép sẵn của đầu kéo; không thể ghép moóc khác khớp loại container khi đầu kéo đang ghép sai.

## Expected (sau khi sửa)
- Hiện "Moóc đang ghép: {biển} · {loại}" (hoặc "chưa ghép moóc — chọn moóc bên dưới").
- Select "Moóc cho chuyến (ghi đè)": mặc định "Dùng moóc đang ghép (…)" → body không có `trailerId`; chọn moóc ACTIVE khác → body gửi `trailerId` + note so sánh hai biển số.
- Moóc INACTIVE/deleted không vào danh sách; nếu moóc đang ghép rớt khỏi danh sách ACTIVE thì vẫn có mặt như một lựa chọn (picker không nói dối về mặc định).
- Lỗi 409 từ backend hiện nguyên văn ở dòng lỗi của section; không invalidate/chặn gì phía FE.

## Automated pins (DispatchPlanEditorCell.test.tsx, red-first đã chứng minh)
1. Không chọn gì → `body.trailerId` undefined + dòng "Moóc đang ghép: 15R-182.06" hiện (tại HEAD: 3/4 test mới FAIL).
2. Chọn "30R-555.55 · 40FT" → `body.trailerId === 7` + note "Ghi đè moóc: 30R-555.55 … thay cho moóc đang ghép 15R-182.06."
3. Moóc INACTIVE không có trong options; moóc ACTIVE có.
4. 409 "Rơ-moóc không phù hợp với loại container." hiện nguyên văn qua issue error.

## Not covered
- Rung 3: phát lệnh thật trên staging với ghi đè (lane chính; dev session READ-ONLY).
- Reassign-side override (cần map `trailerId` ở route reassign — 1 dòng backend, cần owner ack).
