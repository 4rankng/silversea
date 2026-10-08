# Card 051026230645 — Driver: upload ảnh biên bản thứ hai ghi đè mất ảnh đầu (P1 silent data loss)

Case ID: TC-373-01
Feature: khu "Hình ảnh" trong thẻ "Số cont & seal" của chi tiết chuyến lái xe — upload biên bản giao hàng (trip_photos type DELIVERY_NOTE qua POST /api/upload).

## Repro (đã đối chiếu mã nguồn + tái lập unit tại HEAD)
1. Đăng nhập Lái xe → chi tiết chuyến → thẻ "Số cont & seal" → "Thêm ảnh biên bản".
2. Upload ảnh A (pod-ha-bai.png) → lưu thành công; upload ảnh B (pod-bien-ban.png) qua cùng nút.
3. Mở viewer: hiện "1/1" — chỉ còn B; A biến mất khỏi mọi bề mặt hiển thị (bento tile, preview, viewer).

## Root cause (audit kết luận)
- Backend `POST /api/upload` (upload.trip-photo) **APPEND**: mỗi upload chèn MỘT dòng `trip_photos` mới — API KHÔNG giới hạn số ảnh, KHÔNG overwrite. Hai upload = hai dòng storage.
- Mất dữ liệu là lỗi FE: `DriverTripDetailPage` đọc danh sách `containerSealPhotos` từ wire rồi **co rút bằng `.find(p => p.type === 'DELIVERY_NOTE')`** — chỉ giữ dòng mới nhất (comment cũ ghi rõ "latest row wins"), mọi upload trước đó biến mất khỏi hiển thị. Dữ liệu KHÔNG mất trong DB — mất khỏi tầm nhìn người dùng (vẫn là lỗi P1 theo nghĩa người dùng).

## Expected (đã sửa)
- Mọi ảnh biên bản đã upload đều hiển thị: mỗi ảnh một tile riêng kèm nút xóa RIÊNG theo đúng storage_key (không bao giờ xóa nhầm "ảnh mới nhất"); viewer đi hết danh sách [cont, seal, ...mọi biên bản] (đếm n/n trung thực).
- Nhãn giữ nguyên khi chỉ có 1 ảnh ("Xem ảnh biên bản", "Xóa ảnh biên bản"); từ 2 ảnh trở lên thêm chỉ số ("Xem ảnh biên bản 2"…).
- Upload mới LUÔN thêm vào, không bao giờ thay thế, không cần cảnh báo (không còn hành vi thay thế).

## Automated pins
- `frontend/src/pages/DriverTripDetailPage.test.tsx` — "two persisted biên bản uploads both stay visible — no silent replace": hai dòng DELIVERY_NOTE trên wire → cả hai tile render, cả hai storage_key đều được đọc hiển thị. ĐỎ tại HEAD (chỉ dòng đầu render), XANH sau fix.
- `frontend/src/components/trip/DriverContainerCard.test.tsx` — "renders every biên bản photo as its own tile with per-photo delete": N tile, nhãn có chỉ số, delete gọi đúng `storage_key` + idempotency key theo key đó; test cũ "deletes only the displayed delivery-note storage key" giữ nguyên hành vi single-photo.

## UI DRIVEN (rung 3, môi trường LOCAL — staging không bị đụng)
- Tài khoản dvthuc (DRIVER), fixture trip 35381 / fulfillment 23699 (C12 fixture có sẵn, được gán driver trong lúc test rồi gán lại về không).
- Bằng chứng: 2 ảnh seed qua API cùng hiển thị; upload THỨ BA qua chính input thật của app (`Chọn ảnh biên bản`) → 2→3 figure, nhãn xóa có chỉ số 1..3, toast "Đã lưu ảnh biên bản giao hàng."; xóa theo key trên UI remove ĐÚNG 1 ảnh (còn 2, nhãn đánh lại chỉ số).
- Files: `testplan/qa/evidence/2026-10-06_card051026230645-driver-note-multi/` (after-third-upload.png, photo-strip-three-photos.png, after-per-key-delete.png, driver-log.json, diag.png). Ảnh fixture là JPEG 1×1 nên ô ảnh hiện trắng — tile + nhãn + blob-load là nội dung chứng minh.

## Not covered bởi hồ sơ này
- Nhãn "Chứng từ" theo e-POD: upload tại đây vẫn là trip_photos DELIVERY_NOTE (nhóm "Ảnh"). Cho nó thỏa mãn gate "Biên bản giao nhận đã ký" (POD submission) là đổi luật nghiệp vụ — cần owner chốt, chưa làm.
- Ảnh cont/seal vẫn hiển thị "mới nhất" (đúng thiết kế re-capture cho ảnh OCR); nếu 0636 muốn multi-display cho cont/seal, pattern list-prop + per-key tile này tái dùng trực tiếp.
- Staging QA (build thật, ảnh thật) do lane chính thực hiện sau deploy.
