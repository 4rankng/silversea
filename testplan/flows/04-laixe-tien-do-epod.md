# Luồng 4: Cập nhật tiến độ & e-POD — Lái xe (Driver)

> **Vai trò sở hữu:** Lái xe (DRIVER)
> **Tài khoản demo:** `laixe` (password: `Abc123`)
> **Route chính:** `/my-trips/:id` (milestone, chi phí, e-POD), `/shipments/:id` (e-POD panel)
> **Thiết bị mặc định:** Mobile (iPhone SE 375×667)
> **PRD nguồn:** Module 08, O2C Bước 3, TC-MO2C-05, TC-MO2C-06, TC-MO2C-07
>
> **Tổng quan luồng:** Sau khi nhận lệnh (IN_TRANSIT), lái xe thực hiện 4 milestone theo thứ tự:
> (1) Đã lấy vỏ / Lấy hàng (PICKED_UP) → (2) Đang đóng / Trả hàng (LOADING_OR_RETURNING)
> → (3) Đã hạ bãi / Giao hàng xong (DELIVERED). Song song, lái xe ghi nhận chi phí đi đường,
> nhiên liệu, container/seal, và nộp e-POD (2 slot bắt buộc).

---

## 4.1 — 4 Milestone vận hành (theo thứ tự)

### TC-LX-TIENDO-001 — Hoàn thành 4 milestone đúng thứ tự

- **Mã PRD:** TC-MO2C-05, O2C Bước 3
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip IN_TRANSIT (đã nhận lệnh gốc)
- **Các bước:**
  1. Mở `/my-trips/:id`. Bấm "Đã lấy vỏ / Lấy hàng" (PICKED_UP). Ghi timestamp.
  2. Bấm "Đang đóng / Trả hàng" (LOADING_OR_RETURNING). Ghi timestamp.
  3. Bấm "Đã hạ bãi / Giao hàng xong" (DELIVERED). Ghi timestamp.
- **Kết quả mong đợi (Pass):**
  - Mỗi milestone lưu đúng **một lần**, đúng **thứ tự**.
  - Mỗi milestone có timestamp và audit (người thực hiện, thời điểm).
  - Trạng thái trip cập nhật tương ứng sau mỗi milestone.
  - Hoàn tất vận hành (DELIVERED) **chưa tự biến** O2C thành COMPLETED.
- **Kỳ vọng sai (Fail nếu):**
  - Milestone đảo thứ tự (ví dụ DELIVERED trước PICKED_UP).
  - Ghi trùng milestone (bấm lại cùng milestone).
  - Hoàn tất vận hành → tự chuyển COMPLETED (quá sớm, thiếu e-POD + chi phí).
  - Không có timestamp/audit.
- **Bằng chứng:** ảnh trước/sau từng milestone + timestamp + audit

---

### TC-LX-TIENDO-002 — Thử bấm milestone kế trước thứ tự (negative)

- **Mã PRD:** TC-MO2C-05
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip IN_TRANSIT, chưa bấm milestone nào
- **Các bước:**
  1. Thử bấm "Đang đóng / Trả hàng" (bước 2) trước khi bấm "Đã lấy vỏ" (bước 1).
  2. Thử bấm "Đã hạ bãi" (bước 3) trước khi bấm bước 1 và 2.
- **Kết quả mong đợi (Pass):**
  - Hệ thống **chặn** bấm milestone sai thứ tự.
  - Thông báo: "Vui lòng hoàn thành bước trước" hoặc nút disabled.
  - Không thay đổi trạng thái trip.
- **Kỳ vọng sai (Fail nếu):**
  - Cho phép bấm milestone sai thứ tự.
  - Trạng thái trip bị nhảy cóc.
- **Bằng chứng:** ảnh nút disabled/ảnh thông báo chặn

---

### TC-LX-TIENDO-003 — Bấm milestone đã hoàn thành trước đó (idempotent)

- **Vai trò:** `laixe`
- **Mức độ:** P2
- **Tiền điều kiện:** Đã bấm PICKED_UP
- **Các bước:**
  1. Thử bấm lại PICKED_UP.
- **Kết quả mong đợi (Pass):**
  - Nút disabled hoặc thông báo "Đã hoàn thành".
  - Không ghi timestamp mới, không thay đổi audit.
- **Bằng chứng:** ảnh nút disabled

---

## 4.2 — Ghi nhận chi phí đi đường

### TC-LX-TIENDO-004 — Nhập tiền đường thực tế theo container

- **Mã PRD:** TC-MO2C-06
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip đang chạy, có container
- **Các bước:**
  1. Mở `/my-trips/:id`. Vào mục "Chi phí".
  2. Nhập tiền đường thực tế riêng theo container.
  3. Lưu.
  4. Refresh trang.
- **Kết quả mong đợi (Pass):**
  - Chi phí gắn đúng trip/container.
  - Không trộn giữa các container.
  - Dữ liệu tồn tại sau refresh.
- **Kỳ vọng sai (Fail nếu):**
  - Chi phí trộn giữa container.
  - Dữ liệu mất sau refresh.
- **Bằng chứng:** ảnh trước/sau nhập + ảnh sau refresh

---

## 4.3 — Ghi nhận nhiên liệu

### TC-LX-TIENDO-005 — Ghi nhận nhiên liệu với ảnh cột bơm

- **Mã PRD:** TC-MO2C-06, M12
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip đang chạy
- **Các bước:**
  1. Mở chi phí trip. Chọn "Nhiên liệu".
  2. Nhập số lít, đơn giá.
  3. Tải ảnh cột bơm/hóa đơn (`fuel-test.jpg`).
  4. Lưu.
- **Kết quả mong đợi (Pass):**
  - Số lít và đơn giá được bóc tách hiển thị.
  - Ảnh cột bơm được lưu kèm.
  - Chi phí nhiên liệu gắn đúng trip.
  - Dữ liệu tồn tại sau refresh.
- **Kỳ vọng sai (Fail nếu):**
  - Cho lưu thiếu ảnh bắt buộc.
  - Không có bóc tách/đối chiếu nhiên liệu.
  - Chi phí không gắn đúng trip.
- **Bằng chứng:** ảnh form nhiên liệu + ảnh đã lưu + ảnh sau refresh

---

## 4.4 — Ghi nhận Container / Seal

### TC-LX-TIENDO-006 — Ghi số container/seal và ảnh

- **Mã PRD:** TC-MO2C-06
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip đang chạy
- **Các bước:**
  1. Mở chi tiết trip. Nhập số container thực tế, số seal thực tế.
  2. Tải ảnh container (`container-test.jpg`) và ảnh seal (`seal-test.jpg`).
  3. Lưu.
- **Kết quả mong đợi (Pass):**
  - Số container/seal lưu đúng.
  - Ảnh đính kèm xem được.
  - Dữ liệu tồn tại sau refresh.
- **Bằng chứng:** ảnh form + ảnh đã lưu + ảnh sau refresh

---

## 4.5 — Nộp e-POD (2 slot bắt buộc)

### TC-LX-TIENDO-007 — Nộp e-POD thành công với đủ 2 slot

- **Mã PRD:** TC-MO2C-07
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Trip IN_TRANSIT, đã hoàn tất milestone vận hành (DELIVERED)
- **Các bước:**
  1. Mở e-POD trên `/my-trips/:id` hoặc `/shipments/:id`.
  2. Tải slot 1: "Phiếu bãi / phiếu hạ" (`yard-drop-test.jpg`).
  3. Tải slot 2: "Biên bản giao nhận có ký nhận" (`signed-delivery-test.pdf`).
  4. Bấm "Gửi e-POD".
- **Kết quả mong đợi (Pass):**
  - Trạng thái e-POD chuyển sang "Đã gửi duyệt" (SUBMITTED).
  - Submission ID, version, status được ghi nhận.
  - e-POD neo đúng trip/fulfillment và phiên bản hiện tại.
  - Mở `/shipments/:id` xác nhận đúng trip/fulfillment.
- **Kỳ vọng sai (Fail nếu):**
  - Thiếu 1 slot vẫn gửi được.
  - Submission gắn sai trip.
  - Không có version/history.
  - Submit tự duyệt hoặc tự hoàn thành trip.
- **Bằng chứng:** ảnh 2 slot đã tải + ảnh status SUBMITTED + ảnh `/shipments/:id`

---

### TC-LX-TIENDO-008 — Chặn gửi e-POD khi thiếu slot bắt buộc (negative)

- **Mã PRD:** TC-MO2C-07
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Các bước:**
  1. Mở e-POD. Chỉ tải "Phiếu bãi / phiếu hạ" (slot 1).
  2. **Không** tải "Biên bản giao nhận" (slot 2). Thử bấm "Gửi e-POD".
  3. Thử ngược lại: chỉ tải slot 2, thiếu slot 1.
- **Kết quả mong đợi (Pass):**
  - Bị chặn: "Thiếu hồ sơ bắt buộc" hoặc nút disabled.
  - Không gửi được e-POD.
  - Thông báo rõ ràng slot nào thiếu.
- **Kỳ vọng sai (Fail nếu):**
  - Thiếu 1 file vẫn gửi được.
  - Không thông báo slot thiếu.
- **Bằng chứng:** ảnh thông báo chặn khi thiếu slot 1 + ảnh khi thiếu slot 2

---

### TC-LX-TIENDO-009 — Vé cầu đường là tùy chọn

- **Mã PRD:** TC-MO2C-07
- **Vai trò:** `laixe`
- **Mức độ:** P2
- **Các bước:**
  1. Tải đủ 2 slot bắt buộc. Không tải vé cầu đường.
  2. Bấm "Gửi e-POD".
- **Kết quả mong đợi (Pass):**
  - Gửi thành công. Vé cầu đường không bắt buộc.
- **Bằng chứng:** ảnh e-POD SUBMITTED không có vé cầu đường

---

## 4.6 — Gửi chờ duyệt phí (kết thúc phần lái xe)

### TC-LX-TIENDO-010 — Bấm "Gửi chờ duyệt phí" sau khi hoàn tất

- **Mã PRD:** TC-MO2C-05, TC-MO2C-06
- **Vai trò:** `laixe`
- **Mức độ:** P0
- **Thiết bị:** Mobile
- **Tiền điều kiện:** Đã hoàn tất milestone DELIVERED, đã nhập chi phí, đã nộp e-POD
- **Các bước:**
  1. Mở `/my-trips/:id`. Bấm "Gửi chờ duyệt phí".
  2. Kiểm tra trạng thái trip/shipment.
- **Kết quả mong đợi (Pass):**
  - Trip chuyển sang trạng thái chờ duyệt phí.
  - Ops/Kế toán nhận được để xử lý tiếp.
  - Không tự chuyển COMPLETED (còn phải chờ duyệt chi phí + e-POD).
- **Kỳ vọng sai (Fail nếu):**
  - Tự chuyển COMPLETED khi chưa duyệt e-POD + chi phí.
  - Ops/Kế toán không thấy chuyến.
- **Bằng chứng:** ảnh trạng thái sau gửi + ảnh màn Ops

---

## 4.7 — Xem thu nhập & Phiếu lương

### TC-LX-TIENDO-011 — Xem thu nhập cá nhân

- **Mã PRD:** M08
- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Các bước:**
  1. Mở `/my-earnings`. Kiểm tra tổng thu nhập, danh sách chuyến đã hoàn thành.
  2. Mở `/my-payslips`. Kiểm tra phiếu lương đã phát hành.
- **Kết quả mong đợi (Pass):**
  - Thu nhập hiển thị đúng theo chuyến đã hoàn thành.
  - Phiếu lương xem được, mở được file PDF.
  - Chỉ thấy dữ liệu của chính mình.
- **Bằng chứng:** ảnh `/my-earnings` + ảnh `/my-payslips`

---

### TC-LX-TIENDO-012 — Xem khoản phạt cá nhân

- **Mã PRD:** M08
- **Vai trò:** `laixe`
- **Mức độ:** P1
- **Thiết bị:** Mobile
- **Các bước:**
  1. Mở `/my-penalties`. Kiểm tra danh sách khoản phạt (nếu có).
- **Kết quả mong đợi (Pass):**
  - Hiển thị đúng khoản phạt của chính mình.
  - Nếu không có: empty state rõ ràng.
  - Không lộ dữ liệu phạt của lái xe khác.
- **Bằng chứng:** ảnh `/my-penalties`

---

## Bảng nghiệm thu — Luồng Tiến độ & e-POD (Lái xe)

| Ngày thử | Mã TC | Người thử | Kết quả | Ghi chú | Bằng chứng |
|-----------|-------|-----------|---------|---------|------------|
| __/__/__ | TC-LX-TIENDO-001 | | | 4 milestone đúng thứ tự | |
| __/__/__ | TC-LX-TIENDO-002 | | | Milestone sai thứ tự | |
| __/__/__ | TC-LX-TIENDO-003 | | | Milestone idempotent | |
| __/__/__ | TC-LX-TIENDO-004 | | | Tiền đường | |
| __/__/__ | TC-LX-TIENDO-005 | | | Nhiên liệu + ảnh | |
| __/__/__ | TC-LX-TIENDO-006 | | | Container/Seal | |
| __/__/__ | TC-LX-TIENDO-007 | | | e-POD đủ 2 slot | |
| __/__/__ | TC-LX-TIENDO-008 | | | e-POD thiếu slot | |
| __/__/__ | TC-LX-TIENDO-009 | | | Vé cầu đường tùy chọn | |
| __/__/__ | TC-LX-TIENDO-010 | | | Gửi chờ duyệt phí | |
| __/__/__ | TC-LX-TIENDO-011 | | | Thu nhập/Phiếu lương | |
| __/__/__ | TC-LX-TIENDO-012 | | | Khoản phạt | |
